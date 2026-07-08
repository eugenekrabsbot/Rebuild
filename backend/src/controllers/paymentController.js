const db = require('../config/database');

const { v4: uuidv4 } = require('uuid');

const fs = require('fs');

const path = require('path');

const paymentConfig = require('../config/paymentConfig');
const log = require('../utils/logger');

const { createVpnAccount } = require('../services/userService');
const { recordEvent } = require('../services/paymentEventService');

const vpnAccountScheduler = require('../services/vpnAccountScheduler');



const plisioService = require('../services/plisioService');

const zipTaxService = require('../services/ziptaxService');


// Re-export affiliateCommissionService.applyAffiliateCommissionIfEligible so existing
// importers (webhookController, paymentProcessingService) continue to work without changes.
// The actual implementation lives in affiliateCommissionService.js.
const {
  applyAffiliateCommissionIfEligible,
} = require('../services/affiliateCommissionService');
const { normalizeAffiliateCode } = require('../utils/affiliateUtils');
const { inferBaseUrls } = require('../utils/urlUtils');





const ALLOWED_CRYPTO_CURRENCIES = new Set([

  'BTC', // Bitcoin

  'LTC', // Litecoin

  'DASH', // Dash

  'ZEC', // Zcash

  'DOGE', // Dogecoin

  'BCH', // Bitcoin Cash

  'XMR', // Monero

  'USDC', // USD Coin (ERC-20)

  'USDC_BEP20', // USDC BEP-20

  'USDT', // Tether ERC-20

  'USDT_TRX', // Tether TRC-20

  'USDT_BEP20', // Tether BEP-20

  'TON', // Toncoin

  'APE', // ApeCoin ERC-20

  'SOL', // Solana

  'LOVE', // Love Bit BEP-20

  'ETH', // Ethereum

  'BASE_ETH', // Ethereum Base

  'ETC', // Ethereum Classic

  'BTTC_TRX', // BitTorrent-Chain TRC-20

  'BUSD_BEP20', // Binance USD BEP-20

  'BNB', // BNB Chain

  'TRX', // Tron

  'SHIB', // Shiba Inu ERC-20

]);



const calculatePeriodEnd = (interval, startDate = new Date()) => {

  const end = new Date(startDate);

  switch (String(interval || '').toLowerCase()) {

    case 'month':

      end.setMonth(end.getMonth() + 1);

      break;

    case 'quarter':

      end.setMonth(end.getMonth() + 3);

      break;

    case 'semi_annual':

      end.setMonth(end.getMonth() + 6);

      break;

    case 'year':

      end.setFullYear(end.getFullYear() + 1);

      break;

    default:

      end.setMonth(end.getMonth() + 1);

  }

  return end;

};




// Get available plans (requires authentication)

const getPlans = async (req, res) => {

  try {

    const result = await db.query('SELECT * FROM plans ORDER BY amount_cents');

    res.json({ plans: result.rows });

  } catch (error) {

    log.error('Get plans error', { error: error.message });

    res.status(500).json({ error: 'Failed to get plans' });

  }

};



// Helper to extract minimal location info for tax calculation

const extractLocationFromBody = (body = {}) => {

  const billing = body.billingInfo || {};



  const country = (body.country || billing.country || '').trim();

  const region =

    (body.stateOrProvince || body.region || billing.state || '').trim();

  const postalCode =

    (body.postalCode || body.zip || body.postal || billing.zip || '').trim();



  return { country, region, postalCode };

};



// Create checkout session (requires authentication)

const createCheckout = async (req, res) => {

  try {

    const {

      planId,

      paymentMethod,

      cardData,

      billingInfo,

      returnUrl,

      cancelUrl,

      affiliateId,

      payerWalletAddress

    } = req.body;

    const userId = req.user.id;



    // Get user details

    const userResult = await db.query(

      'SELECT account_number, email, is_active FROM users WHERE id = $1',

      [userId]

    );



    if (userResult.rows.length === 0) {

      return res.status(404).json({ error: 'User not found' });

    }



    const user = userResult.rows[0];



    // Get plan details

    // Accept both UUID plan IDs and legacy frontend aliases (monthly/quarterly/semiannual/annual)

    const planAliases = {

      monthly: 'monthly',

      quarterly: 'quarterly',

      semiannual: 'semi-annual',

      'semi-annual': 'semi-annual',

      annual: 'annual'

    };



    const normalizedPlanInput = String(planId || '').trim();

    const lowerPlanInput = normalizedPlanInput.toLowerCase();

    const aliasPlanInput = planAliases[lowerPlanInput] || lowerPlanInput;



    const planResult = await db.query(

      `SELECT * FROM plans

       WHERE id::text = $1

          OR lower(name) = lower($2)

          OR lower(replace(name, '‑', '-')) = lower($2)

       LIMIT 1`,

      [normalizedPlanInput, aliasPlanInput]

    );



    if (planResult.rows.length === 0) {

      return res.status(400).json({ error: 'Invalid plan' });

    }



    const plan = planResult.rows[0];

    const safeAffiliateCode = normalizeAffiliateCode(affiliateId);



    // Auto-apply per-affiliate-link discount (from affiliate_link_discounts table)

    let discountedBaseCents = plan.amount_cents;

    let perLinkDiscount = 0;
    if (safeAffiliateCode) {

      const discountResult = await db.query(

        `SELECT ald.discount_cents

         FROM affiliate_links al

         JOIN affiliate_link_discounts ald ON al.id = ald.affiliate_link_id

         WHERE UPPER(al.code) = UPPER(\$1) AND al.active = true LIMIT 1`,

        [safeAffiliateCode]

      );

      perLinkDiscount = discountResult.rows[0]?.discount_cents || 0;

      if (perLinkDiscount > 0) {

        discountedBaseCents = Math.max(0, plan.amount_cents - perLinkDiscount);

        log.info("Affiliate link discount", { perLinkDiscount, originalCents: plan.amount_cents, discountedCents: discountedBaseCents });

      }

    }





    // ----- Sales tax (ZipTax) integration -----

    // Minimal location: country + state/province + postal code

    const { country, region, postalCode } = extractLocationFromBody(req.body);



    let taxRate = 0;

    let taxAmountCents = 0;

    let totalAmountCents = discountedBaseCents;



    // Normalize country for ZipTax (supports USA/CAN). We only charge tax for US in v1.

    const countryNormalized = String(country || '').trim().toUpperCase();

    const isUSCustomer = ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(

      countryNormalized

    );



    if (isUSCustomer) {

      if (!region || !postalCode) {

        return res.status(400).json({

          error: 'Unable to fetch crucial data, please try again later',

          details: 'Missing state or postal code for tax calculation.'

        });

      }



      try {

        const { rate } = await zipTaxService.lookupCombinedSalesTaxRate({

          countryCode: 'USA',

          region,

          postalCode

        });



        taxRate = rate || 0;

        taxAmountCents = Math.round(discountedBaseCents * taxRate);

        totalAmountCents = discountedBaseCents + taxAmountCents;

      } catch (err) {

        log.error('ZipTax error during checkout', { error: err.message || String(err) });

        return res.status(503).json({

          error: 'Unable to fetch crucial data, please try again later'

        });

      }

    }



    if (paymentMethod === 'crypto') {

      const cryptoCurrency = String((req.body.cryptoCurrency || 'BTC')).trim().toUpperCase() || 'BTC';

      if (!ALLOWED_CRYPTO_CURRENCIES.has(cryptoCurrency)) {

        return res.status(400).json({ error: 'Unsupported cryptocurrency' });

      }



      const forwardedProto = req.headers['x-forwarded-proto'];

      const forwardedHost = req.headers['x-forwarded-host'];

      const directHost = req.headers.host;

      const configuredBaseUrl = process.env.FRONTEND_URL || process.env.API_BASE_URL || 'https://ahoyvpn.net';

      const inferredBaseUrl = (forwardedHost || directHost)

        ? `${forwardedProto || 'https'}://${forwardedHost || directHost}`

        : null;

      const baseApiUrl = (inferredBaseUrl || configuredBaseUrl).replace(/\/$/, '');

      const appBaseUrl = baseApiUrl.replace(/\/api\/?$/, '');

      const callbackUrl = `${baseApiUrl}/api/webhooks/plisio`;

      const successPageUrl = returnUrl || `${appBaseUrl}/dashboard.html?payment=success`;

      const cancelPageUrl = cancelUrl || `${appBaseUrl}/checkout.html?payment=failed`;



      const invoice = await createPlisioInvoice(

        { ...plan, total_amount_cents: totalAmountCents },

        user,

        cryptoCurrency,

        callbackUrl,

        successPageUrl,

        cancelPageUrl

      );



      const periodStart = new Date();

      const periodEnd = calculatePeriodEnd(plan.interval, periodStart);

      const subscriptionId = uuidv4();



      await db.query(

        `INSERT INTO subscriptions (

           id, user_id, plan_id, status,

           current_period_start, current_period_end,

           created_at, updated_at,

           referral_code, plisio_invoice_id, metadata

         ) VALUES (

           $1, $2, $3, 'trialing',

           $4, $5,

           NOW(), NOW(),

           $6, $7, $8::jsonb

         )`,

        [

          subscriptionId,

          userId,

          plan.id,

          periodStart,

          periodEnd,

          safeAffiliateCode,

          invoice.invoiceId,

          JSON.stringify({

            payment_method: 'plisio',

            crypto_currency: cryptoCurrency,

            status: 'pending_payment',

            wallet_address: invoice.walletAddress,

            invoice_url: invoice.invoiceUrl,

            plan_interval: plan.interval,

            plan_amount_cents: plan.amount_cents,

            tax_amount_cents: taxAmountCents,

            tax_rate: taxRate,

            total_amount_cents: totalAmountCents,

            payer_wallet_address: payerWalletAddress || null

          })

        ]

      );



      await db.query(

        `INSERT INTO payments (id, user_id, subscription_id, amount_cents, currency, status, payment_method, payment_intent_id, invoice_url, created_at)

         VALUES ($1, $2, $3, $4, $5, 'pending', 'plisio', $6, $7, NOW())`,

        [

          uuidv4(),

          userId,

          subscriptionId,

          totalAmountCents,

          plan.currency || 'USD',

          invoice.invoiceId,

          invoice.invoiceUrl

        ]

      );



      return res.json({

        paymentMethod: 'crypto',

        flow: 'plisio',

        cryptoCurrency,

        subscriptionId,

        invoice,

        pricing: {

          currency: plan.currency || 'USD',

          baseAmountCents: plan.amount_cents,

          discountCents: perLinkDiscount || 0,

          discountedBaseCents,

          taxAmountCents,

          totalAmountCents

        }

      });

    } else if (paymentMethod !== 'crypto') {

      return res.status(400).json({
        error: 'Credit cards are no longer supported. Please use cryptocurrency checkout.'
      });

    } else {

      res.status(400).json({ error: 'Invalid payment method' });

    }

  } catch (error) {

    log.error('Checkout error', { error: error.message });

    res.status(500).json({ error: 'Checkout failed', message: error.message });

  }

};



// Helper functions

async function createPlisioInvoice(plan, user, cryptoCurrency, callbackUrl, successUrl, cancelUrl) {

  const amountUsd = (plan.total_amount_cents != null ? plan.total_amount_cents : plan.amount_cents) / 100;

  const orderNumber = `CRYPTO-${user.account_number || uuidv4().split('-')[0]}-${String(Date.now()).slice(-6)}`;

  const orderName = `AhoyVPN ${plan.name || plan.plan_key || 'Plan'}`;

  const invoice = await plisioService.createInvoice(

    amountUsd,

    cryptoCurrency,

    orderName,

    orderNumber,

    callbackUrl,

    successUrl,

    cancelUrl,

    user.email || ''

  );



  return {

    invoiceId: invoice.invoiceId,

    invoiceUrl: invoice.invoiceUrl,

    qrCode: invoice.qrCode,

    walletAddress: invoice.walletAddress,

    amount: invoice.amountDue,

    currency: invoice.currency,

    expiresAt: invoice.expiresAt,

    cryptoCurrency

  };

}



// Get Plisio invoice status (public endpoint for success_callback_url)

const getInvoiceStatus = async (req, res) => {

  try {

    const { invoiceId } = req.params;

    if (!invoiceId) {

      return res.status(400).json({ error: 'Invoice ID required' });

    }

    

    // Optional: verify request is from Plisio (could check IP or token)

    // For now, just return status

    

    const status = await plisioService.getInvoiceStatus(invoiceId);

    res.json({

      success: true,

      invoiceId,

      status: status.status,

      amount: status.amount,

      currency: status.currency,

      paidAt: status.paid_at,

      expiresAt: status.expire_at

    });

  } catch (error) {

    log.error('Invoice status error', { error: error.message });

    res.status(500).json({ error: 'Failed to fetch invoice status' });

  }

};





module.exports = {

  getPlans,

  createCheckout,

  getInvoiceStatus,

  applyAffiliateCommissionIfEligible

};
