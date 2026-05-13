const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const log = require('../utils/logger');
const emailService = require('../services/emailService');
const promoService = require('../services/promoService');
const plisioService = require('../services/plisioService');
const { processPlisioPaymentAsync, processPaymentsCloudPaymentAsync } = require('../services/paymentProcessingService');
const { getAuthorizeTransactionDetails, AuthorizeNetService } = require('../services/authorizeNetUtils');

// Webhook verification interface
// NOTE: Uses __dirname (same directory as this file, i.e. backend/src/controllers/)
// NOT process.cwd() — process.cwd() varies by launch context (PM2 starts from /,
// npm start from project root, tests from backend/), causing log writes to land
// in unpredictable locations or silently fail. Fixed in commit 05:30 UTC session.
const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');
const logAuthorizeEvent = (label, data) => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), label, ...data });
    fs.appendFileSync(path.join(LOG_DIR, 'authorize-webhook.log'), line + '\n');
  } catch (error) {
    log.error('Authorize webhook logging error', { error: error.message });
  }
};

class WebhookVerifier {
  // Verify Plisio webhook signature
  // Plisio uses HMAC-SHA1 of sorted body params (excluding verify_hash) or verify_hash in body
  // Plisio may send callbacks as GET (query params) or POST (JSON body)
  static verifyPlisio(req) {
    const apiKey = process.env.PLISIO_API_KEY;
    if (!apiKey) {
      log.warn('PLISIO_API_KEY not configured');
      return false;
    }

    const source = req.method === 'GET' ? req.query : req.body;
    const signature = req.headers['x-plisio-signature'];

    // Method 1: X-Plisio-Signature header (HMAC-SHA1 of sorted params)
    if (signature) {
      const sortedParams = Object.keys(source)
        .filter(key => key !== 'verify_hash')
        .sort()
        .map(key => `${key}=${source[key]}`)
        .join('&');

      const expectedSignature = crypto
        .createHmac('sha1', apiKey)
        .update(sortedParams)
        .digest('hex');

      const providedBuf = Buffer.from(String(signature));
      const expectedBuf = Buffer.from(expectedSignature);
      if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
        return true;
      }
    }

    // Method 2: verify_hash in params (HMAC-SHA1)
    if (source.verify_hash) {
      const { verify_hash, ...rest } = source;
      const sortedParams = Object.keys(rest)
        .sort()
        .map(key => `${key}=${rest[key]}`)
        .join('&');
      const hash = crypto.createHmac('sha1', apiKey).update(sortedParams).digest('hex');
      return hash === verify_hash;
    }

    return false;
  }
  
  // Verify PaymentsCloud webhook signature
  static verifyPaymentsCloud(req) {
    const secret = process.env.PAYCLOUD_SECRET;
    if (!secret) {
      log.warn('PAYCLOUD_SECRET not configured');
      return false;
    }
    
    // PaymentsCloud sends signature in X-PaymentsCloud-Signature header
    const signature = req.headers['x-paymentscloud-signature'];
    if (!signature) {
      return false;
    }
    
    // Create expected signature
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const providedBuf = Buffer.from(String(signature));
    const expectedBuf = Buffer.from(expectedSignature);
    if (providedBuf.length !== expectedBuf.length) return false;

    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  }

  // Verify Authorize.net webhook signature
  static verifyAuthorizeNet(req) {
    const signatureKey = process.env.AUTHORIZE_SIGNATURE_KEY;
    if (!signatureKey) {
      log.warn('AUTHORIZE_SIGNATURE_KEY not configured');
      return false;
    }

    const header = req.headers['x-anet-signature'] || '';
    const provided = header.replace(/^sha512[:=]/i, '').trim();
    if (!provided) return false;

    const raw = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));

    // Support both formats seen in the wild:
    // 1) hex key bytes (Authorize docs style)
    // 2) plain ASCII string key (observed in some environments)
    const expectedHexKey = crypto
      .createHmac('sha512', Buffer.from(signatureKey, 'hex'))
      .update(raw)
      .digest('hex');

    const expectedAsciiKey = crypto
      .createHmac('sha512', signatureKey)
      .update(raw)
      .digest('hex');

    const providedBuf = Buffer.from(provided, 'hex');
    if (!providedBuf.length) return false;

    const expectedHexBuf = Buffer.from(expectedHexKey, 'hex');
    const expectedAsciiBuf = Buffer.from(expectedAsciiKey, 'hex');

    const hexMatch = providedBuf.length === expectedHexBuf.length && crypto.timingSafeEqual(providedBuf, expectedHexBuf);
    const asciiMatch = providedBuf.length === expectedAsciiBuf.length && crypto.timingSafeEqual(providedBuf, expectedAsciiBuf);

    return hexMatch || asciiMatch;
  }
  
  // Check for replay attacks
  static async isReplayAttack(webhookId, provider) {
    const result = await db.query(
      'SELECT id FROM webhook_verifications WHERE webhook_id = $1 AND provider = $2',
      [webhookId, provider]
    );
    return result.rows.length > 0;
  }
  
  // Record webhook processing
  static async recordWebhook(webhookId, provider, signature) {
    await db.query(
      `INSERT INTO webhook_verifications (provider, webhook_id, signature, processed_at, created_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (webhook_id) DO NOTHING`,
      [provider, webhookId, signature]
    );
  }
}

// Plisio webhook handler - Plisio sends GET or POST callbacks
const plisioWebhook = async (req, res) => {
  try {
    // Plisio may send as GET (query params) or POST (JSON body)
    const source = req.method === 'GET' ? req.query : req.body;
    log.info('Plisio webhook received', { source });
    
    // Verify webhook signature
    const isValid = WebhookVerifier.verifyPlisio(req);
    if (!isValid) {
      log.error('Invalid Plisio webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    const {
      status,
      order_number,
      invoice_id,
      tx_id,
      currency,
      amount,
      email,
      account_number
    } = source;

    // Basic payload validation
    const webhookId = invoice_id || order_number;
    if (!status || !webhookId) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    
    // Check for replay attack
    if (await WebhookVerifier.isReplayAttack(webhookId, 'plisio')) {
      log.info('Replay attack detected, ignoring Plisio webhook', { webhookId });
      return res.json({ received: true, status: 'ignored' });
    }
    
    // Record webhook
    await WebhookVerifier.recordWebhook(webhookId, 'plisio', req.headers['x-plisio-signature']);
    
    log.info('Plisio webhook received', { status, order_number, invoice_id });
    
    // Return 200 OK immediately
    res.json({ received: true, status });
    
    // Process payment asynchronously (don't await)
    if (status === 'completed') {
      // invoice_id is Plisio's txn_id; order_number is our merchant order ID
      // If invoice_id is missing, use order_number as fallback
      const effectiveInvoiceId = invoice_id || order_number;
      processPlisioPaymentAsync(effectiveInvoiceId, tx_id, amount, currency).catch(err => {
        log.error('Async Plisio payment processing error', { error: err.message });
      });
    }
  } catch (error) {
    log.error('Plisio webhook error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Async payment processing for Plisio
// (moved to services/paymentProcessingService.js)

// PaymentsCloud webhook handler - returns 200 OK immediately, processes async
const paymentsCloudWebhook = async (req, res) => {
  try {
    log.info('PaymentsCloud webhook received', { body: req.body });
    
    // Verify webhook signature
    const isValid = WebhookVerifier.verifyPaymentsCloud(req);
    if (!isValid) {
      log.error('Invalid PaymentsCloud webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    const { event, data } = req.body;

    // Basic payload validation
    if (!event || !data || !data.id) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    
    // Check for replay attack
    const webhookId = data.id;
    if (await WebhookVerifier.isReplayAttack(webhookId, 'paymentscloud')) {
      log.info('Replay attack detected, ignoring PaymentsCloud webhook', { webhookId });
      return res.json({ received: true, status: 'ignored' });
    }
    
    // Record webhook
    await WebhookVerifier.recordWebhook(webhookId, 'paymentscloud', req.headers['x-paymentscloud-signature']);
    
    log.info('PaymentsCloud webhook', { event, payment_id: data.id });
    
    // Return 200 OK immediately
    res.json({ received: true, status: event });
    
    // Process payment asynchronously (don't await)
    if (event === 'payment.succeeded') {
      processPaymentsCloudPaymentAsync(data).catch(err => {
        log.error('Async PaymentsCloud payment processing error', { error: err.message });
      });
    }
  } catch (error) {
    log.error('PaymentsCloud webhook error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Authorize.net webhook handler
const authorizeNetWebhook = async (req, res) => {
  try {
    // Temporary debug logging — keep minimal to avoid leaking full payloads
    const sigHeader = req.headers['x-anet-signature'] || '';
    // Accept either "sha512=<hmac>" or "sha512:<hmac>"; fallback to raw header
    const provided = sigHeader.replace(/^sha512[:=]/i, '').trim();
    const raw = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    const signatureKey = process.env.AUTHORIZE_SIGNATURE_KEY || '';
    const expectedHex = crypto
      .createHmac('sha512', Buffer.from(signatureKey, 'hex'))
      .update(raw)
      .digest('hex');
    const expectedAscii = crypto
      .createHmac('sha512', signatureKey)
      .update(raw)
      .digest('hex');

    const payload = req.body?.payload || req.body || {};
    let responseCode = String(
      payload.responseCode ||
      payload.response_code ||
      payload?.response?.responseCode ||
      payload?.transactionResponse?.responseCode ||
      ''
    ).trim();
    const transactionId = String(payload.id || payload.transId || payload.transactionId || payload?.trans_id || '').trim();
    let invoiceNumber = String(
      payload.invoiceNumber ||
      payload.invoice_number ||
      payload?.order?.invoiceNumber ||
      payload?.order?.invoice_number ||
      ''
    ).trim();
    let amountRaw = payload.authAmount || payload.amount || payload.auth_amount || payload?.authAmount || null;

    const isValid = WebhookVerifier.verifyAuthorizeNet(req);

    if (isValid && transactionId && (!invoiceNumber || responseCode !== '1')) {
      const txDetails = await getAuthorizeTransactionDetails(transactionId);
      if (txDetails) {
        invoiceNumber = invoiceNumber || txDetails.invoiceNumber || '';
        responseCode = responseCode || txDetails.responseCode || '';
        amountRaw = amountRaw || txDetails.amountRaw || null;

        logAuthorizeEvent('webhook-transaction-lookup', {
          transactionId,
          invoiceNumber,
          responseCode,
          transactionStatus: txDetails.transactionStatus || null
        });
      }
    }

    // Log every inbound webhook attempt so we can diagnose signature/env mismatches.
    logAuthorizeEvent('webhook-received', {
      responseCode,
      transactionId,
      invoiceNumber,
      amountRaw,
      eventType: req.body?.eventType || req.body?.event_type || null,
      signaturePresent: Boolean(req.headers['x-anet-signature']),
      signatureValid: isValid
    });

    if (!isValid) {
      log.error('Authorize.net signature invalid or missing', {
        hasHeader: Boolean(provided),
        providedPrefix: provided ? provided.slice(0, 16) : 'none',
        expectedHexPrefix: expectedHex ? expectedHex.slice(0, 16) : 'none',
        expectedAsciiPrefix: expectedAscii ? expectedAscii.slice(0, 16) : 'none',
        rawLength: raw.length,
        eventType: req.body?.eventType || req.body?.event_type || null,
        transactionId,
        invoiceNumber
      });
      return res.status(400).json({ received: true, signatureValid: false });
    }

    logAuthorizeEvent('webhook', {
      responseCode,
      transactionId,
      invoiceNumber,
      amountRaw,
      eventType: req.body?.eventType || req.body?.event_type || null,
      signaturePresent: Boolean(req.headers['x-anet-signature']),
      signatureValid: true
    });

    if (!invoiceNumber) {
      log.error('Authorize.net webhook missing invoice number');
      return res.json({ received: true, signatureValid: true });
    }

    if (responseCode !== '1') {
      // Special handling for authcapture.created: responseCode may be empty
      // in the webhook payload even when payment was authorized.
      // Try to extract transaction ID from transactionResponse and look up details.
      const eventType = req.body?.eventType || req.body?.event_type || null;
      const webhookTransId = String(
        payload?.transactionResponse?.transId ||
        payload?.transactionResponse?.trans_id ||
        ''
      ).trim();

      if (webhookTransId && (!invoiceNumber || !responseCode)) {
        const txDetails = await getAuthorizeTransactionDetails(webhookTransId);
        if (txDetails && txDetails.responseCode === '1') {
          invoiceNumber = invoiceNumber || txDetails.invoiceNumber || '';
          responseCode = '1';
          amountRaw = amountRaw || txDetails.amountRaw || null;
        }
      }

      if (responseCode !== '1') {
        log.warn('Authorize.net webhook non-success response', { invoiceNumber, responseCode });
        return res.json({ received: true, signatureValid: true });
      }
    }

    // ── Card-update webhook: Authorize.net fires this when a customer updates their card
    // via the hosted profile page (getHostedProfilePageRequest). The payload contains:
    //   { eventType: 'customerProfileUpdated', payload: { customerProfileId, ... } }
    // We look up the subscription by customerProfileId and return early — no payment action needed.
    if (eventType === 'customerProfileUpdated') {
      const customerProfileId = String(
        req.body?.payload?.customerProfileId ||
        req.body?.customerProfileId ||
        req.body?.profile?.customerProfileId ||
        ''
      ).trim();

      if (!customerProfileId) {
        log.warn('customerProfileUpdated webhook: missing customerProfileId');
        return res.json({ received: true, signatureValid: true });
      }

      const profileSubResult = await db.query(
        `SELECT s.*, p.interval as plan_interval, p.amount_cents
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.customer_profile_id = $1
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [customerProfileId]
      );

      if (profileSubResult.rows.length === 0) {
        log.warn('customerProfileUpdated webhook: subscription not found for profile', { customerProfileId });
        return res.json({ received: true, signatureValid: true });
      }

      log.info('customerProfileUpdated: card updated for subscription', {
        subscriptionId: profileSubResult.rows[0].id,
        customerProfileId
      });

      return res.json({ received: true, signatureValid: true });
    }

    let subResult = await db.query(
      `SELECT s.*, p.interval as plan_interval, p.amount_cents
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
          `SELECT s.*, p.interval as plan_interval, p.amount_cents
           FROM subscriptions s
           JOIN plans p ON p.id = s.plan_id
           WHERE s.account_number = $1
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

    // ARB renewal fallback: look up by arb_subscription_id.
    // Authorize.net ARB renewal webhooks may carry the ARB subscription ID
    // in req.body.payload.subscriptionId — try that before giving up.
    if (subResult.rows.length === 0 && transactionId) {
      // Try transactionId as arb_subscription_id
      const arbFallback = await db.query(
        `SELECT s.*, p.interval as plan_interval, p.amount_cents
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.arb_subscription_id = $1
         LIMIT 1`,
        [transactionId]
      );
      if (arbFallback.rows.length > 0) {
        subResult = arbFallback;
        log.warn('Authorize.net webhook: matched by arb_subscription_id', { transactionId });
      }
    }

    // ARB charged webhook: subscriptionId comes in the payload directly
    // Also try transactionId as arb_subscription_id (for ARB renewal webhooks
    // where the transaction ID of the captured charge = ARB subscription ID)
    if (subResult.rows.length === 0) {
      const arbSubId = String(
        req.body?.payload?.subscriptionId ||
        req.body?.subscriptionId ||
        req.body?.subscription?.id ||
        req.body?.event?.subscriptionId ||
        ''
      ).trim();

      const txAsArb = transactionId ? String(transactionId).trim() : null;

      for (const candidate of [arbSubId, txAsArb]) {
        if (!candidate) continue;
        const arbPayloadFallback = await db.query(
          `SELECT s.*, p.interval as plan_interval, p.amount_cents
           FROM subscriptions s
           JOIN plans p ON p.id = s.plan_id
           WHERE s.arb_subscription_id = $1
           LIMIT 1`,
          [candidate]
        );
        if (arbPayloadFallback.rows.length > 0) {
          subResult = arbPayloadFallback;
          log.warn('Authorize.net webhook: matched by arb_subscription_id', { candidate });
          break;
        }
      }
    }

    if (subResult.rows.length === 0) {
      log.error('Authorize.net webhook: subscription not found', { invoiceNumber });
      return res.json({ received: true, signatureValid: true });
    }

    const subscription = subResult.rows[0];
    const planInterval = subscription.plan_interval || subscription?.metadata?.plan_interval || 'month';

    // ── VPN account provisioning / renewal ─────────────────────────────────────────
    // Runs for ALL subscription states so ARB renewals (already-active) also extend
    // the VPN expiry. Catches errors so VPN failures don't break the webhook response.
    let vpnAccountResult = null;
    if (subscription.account_number && planInterval) {
      try {
        const { createVpnAccount } = require('../services/userService');
        vpnAccountResult = await createVpnAccount(subscription.user_id, subscription.account_number, planInterval, { renew: true });
      } catch (vpnErr) {
        log.error('[Webhook] VPN renewal failed', { error: vpnErr.message, subscriptionId: subscription.id });
      }
    }

    // ARB charge webhooks fire for already-active subscriptions — return early after
    // renewing the VPN so we don't accidentally send a duplicate welcome email.
    if (subscription.status === 'active') {
      return res.json({ received: true, signatureValid: true });
    }

    const amountCents = Math.round((parseFloat(amountRaw || '0') || 0) * 100) || subscription.amount_cents;

    await db.query('BEGIN');
    try {
      await db.query(
        `UPDATE subscriptions
         SET status = 'active',
             updated_at = NOW(),
             metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ authorize_status: 'succeeded', authorize_trans_id: transactionId || null, authorize_response_code: responseCode || null }), subscription.id]
      );

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

      await db.query('UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1', [subscription.user_id]);

      await db.query('COMMIT');

      // Record tax transaction (non-blocking — failure here does not affect payment)
      try {
        const meta = subscription.metadata || {};
        const baseCents     = parseInt(meta.plan_amount_cents, 10) || 0;
        const taxCents      = parseInt(meta.tax_amount_cents, 10) || 0;
        const totalCents    = baseCents + taxCents;
        const postalCode    = (meta.postal_code || '').trim();

        if (postalCode && baseCents > 0) {
          await db.query(
            `INSERT INTO tax_transactions (
               transaction_date, postal_code, country, state,
               base_charge_cents, tax_rate, tax_amount_cents, total_amount_cents,
               invoice_number, subscription_id, user_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              new Date(),
              postalCode,
              (meta.country || 'USA').trim(),
              (meta.state || '').trim(),
              baseCents,
              parseFloat(meta.tax_rate || 0),
              taxCents,
              totalCents,
              invoiceNumber || null,
              subscription.id,
              subscription.user_id
            ]
          );
        }
      } catch (taxErr) {
        log.error('Failed to record tax_transaction', { error: taxErr.message, invoiceNumber });
      }
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

    
    // ARB creation -- runs after subscription activated + VPN provisioned
    {
      const subMeta = (subscription.metadata || {});
      if (!subscription.arb_subscription_id && !subMeta[Symbol.for('arb_subscription_id')] && transactionId) {
        try {
          const svc = new AuthorizeNetService();
          const tx = await getAuthorizeTransactionDetails(transactionId);
          const { customerProfileId, customerPaymentProfileId } = tx || {};
          if (customerProfileId && customerPaymentProfileId) {
            const planInterval = subMeta.plan_interval || 'month';
            let planAmountCents = parseInt(subMeta.plan_amount_cents, 10) || 0;
            if (!planAmountCents) {
              const pr = await db.query('SELECT p.amount_cents FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1', [subscription.id]);
              planAmountCents = pr.rows[0]?.amount_cents || 0;
            }
            const arbAmount = ((planAmountCents || 0) / 100).toFixed(2);
            const startDate = new Date().toISOString().split('T')[0];
            const intervalLength = planInterval === 'year' ? 1 : planInterval === 'quarter' ? 3 : 1;
            const arbResult = await svc.createArbSubscriptionFromProfile({
              amount: arbAmount, intervalLength, intervalUnit: 'months', startDate,
              customerProfileId, customerPaymentProfileId,
              subscriptionId: String(subscription.id), customerEmail: userEmail,
            });
            if (arbResult?.subscriptionId) {
              await db.query('UPDATE subscriptions SET arb_subscription_id = $1, updated_at = NOW() WHERE id = $2', [arbResult.subscriptionId, subscription.id]);
              log.info('[Webhook] ARB created', { arbSubscriptionId: arbResult.subscriptionId, subscriptionId: subscription.id });
            } else {
              log.warn('[Webhook] ARB missing subscriptionId', { arbResult });
            }
          } else {
            log.warn('[Webhook] Missing customerProfileId or customerPaymentProfileId', { transactionId });
          }
        } catch (arbErr) {
          log.error('[Webhook] ARB creation failed', { error: arbErr.message, subscriptionId: subscription.id });
        }
      }
    }

    // Send welcome email only for trialing → active activation (first-time provisioning).
    // For ARB renewals the subscription was already active; vpnAccountResult is null
    // because the early-return above skipped this block.
    const userResult = await db.query('SELECT email FROM users WHERE id = $1', [subscription.user_id]);
    const userEmail = userResult.rows[0]?.email;
    if (userEmail && vpnAccountResult) {
      const expiryDate = new Date(subscription.current_period_end).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      await emailService.sendAccountCreatedEmail(userEmail, vpnAccountResult.username, vpnAccountResult.password, expiryDate);
    }

    return res.json({ received: true, signatureValid: true });
  } catch (err) {
    log.error('Authorize.net webhook error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  WebhookVerifier, // exported for unit testing — do not use in production code
  logAuthorizeEvent, // exported for unit testing
  plisioWebhook,
  paymentsCloudWebhook,
  authorizeNetWebhook
};
