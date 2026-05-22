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

const { getAuthorizeTransactionDetails, AuthorizeNetService, parseHostedPaymentPageResponse } = require('../services/authorizeNetUtils');

// Re-export affiliateCommissionService.applyAffiliateCommissionIfEligible so existing
// importers (webhookController, paymentProcessingService) continue to work without changes.
// The actual implementation lives in affiliateCommissionService.js.
const {
  applyAffiliateCommissionIfEligible,
} = require('../services/affiliateCommissionService');
const { normalizeAffiliateCode } = require('../utils/affiliateUtils');
const { inferBaseUrls } = require('../utils/urlUtils');





// Authorize relay log file path — resolved relative to THIS FILE's directory,
// NOT process.cwd() (which varies depending on where `node` was launched from).
// This ensures logs are always written to backend/logs/ regardless of working directory.
const AUTHORIZE_RELAY_LOG = path.join(__dirname, '..', '..', 'logs', 'authorize-relay.log');

const logAuthorizeRelay = (data) => {

  try {

    const dir = path.dirname(AUTHORIZE_RELAY_LOG);

    fs.mkdirSync(dir, { recursive: true });

    const line = JSON.stringify({ ts: new Date().toISOString(), ...data });

    fs.appendFileSync(AUTHORIZE_RELAY_LOG, line + '\n');

  } catch (error) {

    log.error('Authorize relay logging error', { error: error.message });

  }

};

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

    } else if (paymentMethod === 'card' || paymentMethod === 'card_redirect') {

      // Authorize.net is only available for monthly + quarterly plans

      const allowedAuthorizeIntervals = new Set(['month', 'quarter']);

      if (!allowedAuthorizeIntervals.has(String(plan.interval || '').toLowerCase())) {

        return res.status(400).json({

          error: 'Card payments are only available for Monthly and Quarterly plans.'

        });

      }



      // Preferred flow: Authorize.net hosted payment page redirect

      const useHostedRedirect = paymentMethod === 'card_redirect' || !cardData;



      if (useHostedRedirect) {

                const { appBaseUrl } = inferBaseUrls(req);
        const relayUrl = `${appBaseUrl}/api/payment/authorize/relay`;

        const hostedReturnUrl = relayUrl;

        const hostedCancelUrl = relayUrl;



        // Authorize.net invoiceNumber max length is 20 chars

        const invoiceNumber = `A${user.account_number}${String(Date.now()).slice(-8)}`;



        // Persist pending checkout so we can attribute affiliate + finalize on relay/webhook.

        const periodStart = new Date();

        const periodEnd = calculatePeriodEnd(plan.interval, periodStart);



        await db.query(

          `INSERT INTO subscriptions (

            id, user_id, plan_id, status,

            current_period_start, current_period_end,

            created_at, updated_at,

            referral_code, account_number, metadata

          ) VALUES (

            $1, $2, $3, 'trialing',

            $4, $5,

            NOW(), NOW(),

            $6, $7, $8::jsonb

          )`,

          [

            uuidv4(),

            userId,

            plan.id,

            periodStart,

            periodEnd,

            safeAffiliateCode,

            user.account_number,

            JSON.stringify({

              payment_method: 'authorize',

              status: 'pending_payment',

              invoice_number: invoiceNumber,

              plan_interval: plan.interval,

              plan_amount_cents: plan.amount_cents,

              tax_amount_cents: taxAmountCents,

              tax_rate: taxRate,

              total_amount_cents: totalAmountCents

            })

          ]

        );



        const hosted = await AuthorizeNetService.createHostedPaymentPage({

          amount: totalAmountCents / 100,

          invoiceNumber,

          description: `AhoyVPN ${plan.name || plan.plan_key || 'Plan'}`,

          returnUrl: hostedReturnUrl,

          cancelUrl: hostedCancelUrl,

          email: user.email || ''

        });



        if (process.env.DEBUG_AUTHORIZE_NET === 'true') {

          log.info("Authorize.net hosted token created", {

            invoiceNumber,

            amount: totalAmountCents / 100,

            returnUrl: hostedReturnUrl,

            cancelUrl: hostedCancelUrl,

            formUrl: hosted.formUrl,

            token: hosted.token

          });

        }



        // Bridge URL keeps compatibility with older frontend clients that do GET redirects.

        // Use backend bridge endpoint to avoid frontend CSP/cache issues.

        const bridgeUrl = `${appBaseUrl}/api/payment/hosted-redirect?token=${encodeURIComponent(hosted.token)}&formUrl=${encodeURIComponent(hosted.formUrl)}`;



        return res.json({

          paymentMethod: 'card',

          flow: 'redirect',

          // Intentionally return only bridge URL to avoid frontend CSP-blocked direct POST path

          redirectUrl: bridgeUrl,

          invoiceNumber,

          pricing: {

            currency: plan.currency || 'USD',

            baseAmountCents: plan.amount_cents,

            discountCents: perLinkDiscount || 0,

            discountedBaseCents,

            taxAmountCents,

            totalAmountCents

          }

        });

      }



      // Legacy direct-card flow (fallback only)

      const transaction = await AuthorizeNetService.createTransaction(

        totalAmountCents / 100, // Convert cents to dollars (subtotal + tax)

        cardData,

        billingInfo || {}

      );



      if (transaction.transactionResponse.responseCode === '1') {

        // Payment successful - activate account

        await db.query(

          'UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1',

          [userId]

        );



        // Create subscription

        const subscriptionResult = await db.query(

          `INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)

           VALUES ($1, $2, $3, 'active', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())

           RETURNING id`,

          [uuidv4(), userId, planId]

        );



        return res.json({

          paymentMethod: 'card',

          flow: 'direct',

          success: true,

          accountNumber: user.account_number,

          subscriptionId: subscriptionResult.rows[0].id,

          pricing: {

            currency: plan.currency || 'USD',

            baseAmountCents: plan.amount_cents,

            taxAmountCents,

            totalAmountCents

          }

        });

      }



      return res.status(400).json({

        error: 'Payment failed',

        details: transaction.transactionResponse.errors

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



const hostedRedirectScript = (req, res) => {

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');

  res.status(200).send("(function(){var f=document.getElementById('anet'); if(f){f.submit();}})();");

};



const hostedRedirectBridge = async (req, res) => {

  try {

    const token = String(req.query.token || '').trim();

    const requestedFormUrl = String(req.query.formUrl || '').trim();

    const formUrl = requestedFormUrl || 'https://accept.authorize.net/payment/payment';



    const allowedHosts = new Set(['accept.authorize.net', 'test.authorize.net']);

    let parsed;

    try {

      parsed = new URL(formUrl);

    } catch {

      return res.status(400).send('Invalid formUrl');

    }



    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {

      return res.status(400).send('Invalid formUrl host');

    }



    if (!token) {

      return res.status(400).send('Missing token');

    }



    const safeToken = token

      .replace(/&/g, '&amp;')

      .replace(/</g, '&lt;')

      .replace(/>/g, '&gt;')

      .replace(/"/g, '&quot;')

      .replace(/'/g, '&#39;');



    const safeAction = parsed.toString()

      .replace(/&/g, '&amp;')

      .replace(/</g, '&lt;')

      .replace(/>/g, '&gt;')

      .replace(/"/g, '&quot;')

      .replace(/'/g, '&#39;');



    return res.status(200).send(`<!doctype html>

<html>

  <head>

    <meta charset="utf-8">

    <title>Redirecting…</title>

    <style>

      body { background: #0F1720; color: #E2E8F0; font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }

      .bridge { text-align: center; max-width: 360px; padding: 24px; border-radius: 12px; border: 1px solid #1F2937; background: #111827; }

      .spinner { margin: 1rem auto 0; width: 48px; height: 48px; border-radius: 50%; border: 4px solid transparent; border-top-color: #38BDF8; animation: spin 1s linear infinite; }

      .bridge h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }

      .bridge p { margin-bottom: 0.5rem; font-size: 0.95rem; color: #94A3B8; }

      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

      .bridge small { opacity: 0.6; }

    </style>

  </head>

  <body>

    <form id="anet" method="POST" action="${safeAction}">

      <input type="hidden" name="token" value="${safeToken}" />

    </form>

    <div class="bridge">

      <h1>Preparing Secure Payment</h1>

      <p>Authorize.net is verifying your transaction. This can take up to 90 seconds. Please stay on this page until the redirect completes.</p>

      <div class="spinner"></div>

      <small>Do not refresh or close your browser.</small>

    </div>

    <script src="/api/payment/hosted-redirect-script.js"></script>

    <noscript>

      <p>JavaScript is required. Click continue.</p>

      <button form="anet" type="submit">Continue</button>

    </noscript>

  </body>

</html>`);

  } catch (error) {

    log.error('Hosted redirect bridge error', { error: error.message });

    return res.status(500).send('Bridge failed');

  }

};



const authorizeRelayResponse = async (req, res) => {

  try {

    const payload = req.method === 'POST' ? (req.body || {}) : (req.query || {});



    // Accept.js / opaque token mode: parse x_payload if present
    let responseCode = String(payload.x_response_code || payload.response_code || '').trim();
    let transactionId = String(payload.x_trans_id || payload.transId || '').trim();
    let invoiceNumber = String(payload.x_invoice_num || payload.invoiceNumber || '').trim();
    let amountRaw = String(payload.x_amount || payload.amount || '').trim();
    if (!responseCode && !transactionId && (payload.x_payload || payload.payload)) {
      const { appBaseUrl } = inferBaseUrls(req);
      const relayUrl = `${appBaseUrl}/api/payment/authorize/relay`;
      const parsed = await parseHostedPaymentPageResponse(payload, relayUrl);
      if (parsed) {
        responseCode = parsed.responseCode || '';
        transactionId = parsed.transId || '';
        invoiceNumber = parsed.invoiceNumber || '';
        amountRaw = parsed.amount || '';
      }
    }


        if (process.env.DEBUG_AUTHORIZE_NET === 'true') {

      log.info('Authorize relay payload', {

        method: req.method,

        responseCode,

        transactionId,

        invoiceNumber,

        amountRaw,

        keys: Object.keys(payload || {})

      });

    }



    logAuthorizeRelay({

      method: req.method,

      responseCode,

      transactionId,

      invoiceNumber,

      amountRaw,

      keys: Object.keys(payload || {})

    });



    const { appBaseUrl } = inferBaseUrls(req);

    if (!invoiceNumber) {

      return res.redirect(`${appBaseUrl}/checkout?payment=cancel&reason=missing_invoice`);

    }



    let subResult = await db.query(

      `SELECT s.id, s.user_id, s.referral_code, s.status, s.metadata, s.plan_id,

              p.amount_cents, p.interval as plan_interval, s.account_number,

              s.current_period_start, s.current_period_end

       FROM subscriptions s

       JOIN plans p ON p.id = s.plan_id

       WHERE s.metadata->>'invoice_number' = $1

       ORDER BY s.created_at DESC

       LIMIT 1`,

      [invoiceNumber]

    );



    if (subResult.rows.length === 0) {

      const accountMatch = invoiceNumber.match(/A?(\d{8})/);

      if (accountMatch) {

        const accountNumber = accountMatch[1];

        const fallback = await db.query(

          `SELECT s.id, s.user_id, s.referral_code, s.status, s.metadata, s.plan_id,

                  p.amount_cents, p.interval as plan_interval, s.account_number,

                  s.current_period_start, s.current_period_end

           FROM subscriptions s

           JOIN plans p ON p.id = s.plan_id

           WHERE s.account_number = $1 AND s.status = 'trialing'

           ORDER BY s.created_at DESC

           LIMIT 1`,

          [accountNumber]

        );



        if (fallback.rows.length > 0) {

          subResult = fallback;

          await db.query(

            `UPDATE subscriptions

             SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,

                 updated_at = NOW()

             WHERE id = $2`,

            [JSON.stringify({ invoice_number: invoiceNumber }), fallback.rows[0].id]

          );

        }

      }

    }



    if (subResult.rows.length === 0) {

      return res.redirect(`${appBaseUrl}/checkout?payment=cancel&reason=subscription_not_found`);

    }



    const subscription = subResult.rows[0];



    if (responseCode !== '1') {

      const failedMetaPatch = {

        authorize_status: 'failed',

        authorize_trans_id: transactionId || null,

        authorize_response_code: responseCode || null

      };



      await db.query(

        `UPDATE subscriptions

         SET updated_at = NOW(),

             metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb

         WHERE id = $2`,

        [JSON.stringify(failedMetaPatch), subscription.id]

      );



      return res.redirect(`${appBaseUrl}/checkout?payment=cancel`);

    }



    // Idempotency guard: if already active, return success quickly

    if (subscription.status === 'active') {

      return res.redirect(`${appBaseUrl}/checkout?payment=success&invoice=${encodeURIComponent(invoiceNumber)}`);

    }



    await db.query('BEGIN');



    const successMetaPatch = {

      authorize_status: 'succeeded',

      authorize_trans_id: transactionId || null,

      authorize_response_code: responseCode || null

    };



    await db.query(

      `UPDATE subscriptions

       SET status = 'active',

           updated_at = NOW(),

           metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb

       WHERE id = $2`,

      [JSON.stringify(successMetaPatch), subscription.id]

    );



    // ── Event-driven provisioning with inline fallback ─────────────────────────
    // We record events for every operation. If inline succeeds, the processor skips them.
    // If inline fails, the processor will retry them asynchronously.
    //
    // External IDs for card payments: transactionId is primary, invoiceNumber fallback
    const vpnExternalId = transactionId || invoiceNumber;

    // 1. VPN account creation
    try {
      const vpnResult = await createVpnAccount(subscription.user_id, subscription.account_number, subscription.plan_interval);
      await recordEvent(vpnExternalId, 'authorize', 'provision.vpn', {
        user_id: subscription.user_id,
        account_number: subscription.account_number,
        plan_interval: subscription.plan_interval,
        vpn_username: vpnResult?.username,
        vpn_password: vpnResult?.password,
      }, { status: 'completed', accountNumber: subscription.account_number });
    } catch (vpnErr) {
      log.error('[authorizeRelayResponse] VPN account creation failed', { userId: subscription.user_id, error: vpnErr.message });
      await recordEvent(vpnExternalId, 'authorize', 'provision.vpn', {
        user_id: subscription.user_id,
        account_number: subscription.account_number,
        plan_interval: subscription.plan_interval,
      }, { status: 'pending', accountNumber: subscription.account_number, errorMessage: vpnErr.message });
    }

    // 2. Activate user
    await db.query(
      'UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1',
      [subscription.user_id]
    );

    // 3. AhoyRipper access key
    try {
      const { provisionAccessKey } = require('../services/accessKeyService');
      await provisionAccessKey(subscription.user_id);
      await recordEvent(vpnExternalId, 'authorize', 'provision.key', {
        user_id: subscription.user_id,
      }, { status: 'completed', accountNumber: subscription.account_number });
    } catch (keyErr) {
      log.error('[authorizeRelayResponse] Failed to provision access key', { userId: subscription.user_id, error: keyErr.message });
      await recordEvent(vpnExternalId, 'authorize', 'provision.key', {
        user_id: subscription.user_id,
      }, { status: 'pending', accountNumber: subscription.account_number, errorMessage: keyErr.message });
    }



    const parsedAmountCents = Math.round((parseFloat(amountRaw || '0') || 0) * 100);

    const amountCents = parsedAmountCents > 0 ? parsedAmountCents : parseInt(subscription.amount_cents, 10);



    // ─── ARB Setup for month/quarter plans ───────────────────────────────────

    // After the hosted payment page charges the first month, we create an

    // ARB subscription so Authorize.net handles all future charges automatically.

    // We use the stored payment profile that Authorize.net created automatically

    // when the hosted page processed the payment.

    const arbIntervals = new Set(['month', 'quarter']);

    if (arbIntervals.has(String(subscription.plan_interval || '').toLowerCase())) {

      try {

        // Get stored customerProfileId + customerPaymentProfileId from the transaction

        const txDetails = await getAuthorizeTransactionDetails(transactionId);



        if (txDetails?.customerProfileId && txDetails?.customerPaymentProfileId) {

          // Calculate next billing date (ARB startDate = next cycle, not today)

          const periodEnd = new Date(subscription.current_period_end);

          const arbStartDate = new Date(periodEnd);

          arbStartDate.setDate(arbStartDate.getDate() + 1); // start next day

          const arbStartStr = arbStartDate.toISOString().split('T')[0]; // YYYY-MM-DD



          // interval mapping

          const intervalLength = subscription.plan_interval === 'quarter' ? 3 : 1;

          const intervalUnit = 'months';



          // Get user email for the ARB subscription

          const userResult = await db.query(

            'SELECT email, full_name FROM users WHERE id = $1',

            [subscription.user_id]

          );

          const userEmail = userResult.rows[0]?.email || '';



          // Amount = plan base amount (tax already included in first charge)

          const arbAmount = (parseInt(subscription.amount_cents, 10) / 100).toFixed(2);



          const arbResult = await AuthorizeNetService.createArbSubscriptionFromProfile({

            amount: arbAmount,

            intervalLength,

            intervalUnit,

            startDate: arbStartStr,

            customerProfileId: txDetails.customerProfileId,

            customerPaymentProfileId: txDetails.customerPaymentProfileId,

            subscriberEmail: userEmail,

            description: `AhoyVPN ${subscription.plan_interval === 'quarter' ? 'Quarterly' : 'Monthly'} Plan`,

            invoiceNumber: invoiceNumber

          });



          // Store ARB subscription ID in subscription metadata

          const arbMetaPatch = {

            arb_subscription_id: arbResult.subscriptionId,

            arb_status: 'active',

            arb_start_date: arbStartStr,

            arb_interval_length: intervalLength,

            arb_interval_unit: intervalUnit,

            arb_amount: arbAmount

          };



          await db.query(

            `UPDATE subscriptions

             SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,

                 updated_at = NOW()

             WHERE id = $2`,

            [JSON.stringify(arbMetaPatch), subscription.id]

          );



          log.info("ARB subscription created", { arbSubscriptionId: arbResult.subscriptionId, subscriptionId: subscription.id, arbStartStr });

        } else {

          log.warn("No stored payment profile found — cannot create ARB subscription", { transactionId, subscriptionId: subscription.id });

        }

      } catch (arbError) {

        // Non-fatal: payment already succeeded, log but don't disrupt the flow.

        // The subscription is active; ARB can be retried or set up manually.

        log.error('ARB setup failed (non-fatal — payment succeeded)', { error: arbError.message || String(arbError) });

      }

    }

    // ─── End ARB Setup ───────────────────────────────────────────────────────



    await applyAffiliateCommissionIfEligible({

      affiliateCode: subscription.referral_code,

      accountNumber: subscription.account_number,

      plan: subscription.plan_id,

      amountCents

    });



    // Create payment record for Authorize.net

    await db.query(

      `INSERT INTO payments (

         id, user_id, subscription_id, amount_cents, currency,

         status, payment_method, payment_intent_id, invoice_url,

         created_at, referral_code, account_number

       ) VALUES (

         $1, $2, $3, $4, 'USD',

         'succeeded', 'authorize', $5, $6,

         NOW(), $7, $8

       )`,

      [

        uuidv4(),

        subscription.user_id,

        subscription.id,

        amountCents,

        transactionId || invoiceNumber,

        null,

        subscription.referral_code || null,

        subscription.account_number

      ]

    );



    await db.query('COMMIT');



    return res.redirect(`${appBaseUrl}/checkout?payment=success&invoice=${encodeURIComponent(invoiceNumber)}`);

  } catch (error) {

    try { await db.query('ROLLBACK'); } catch (_) {}

    log.error('Authorize relay processing error', { error: error.message });



    const { appBaseUrl } = inferBaseUrls(req);

    return res.redirect(`${appBaseUrl}/checkout?payment=cancel&reason=processing_error`);

  }

};



module.exports = {

  getPlans,

  createCheckout,

  hostedRedirectScript,

  hostedRedirectBridge,

  authorizeRelayResponse,

  // plisioWebhook — removed: duplicate of webhookController.plisioWebhook, never routed
  // deleteOldAccounts — removed: never wired to any scheduler

  getInvoiceStatus,

  applyAffiliateCommissionIfEligible

};
