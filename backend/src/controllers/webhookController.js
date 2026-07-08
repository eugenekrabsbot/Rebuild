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

module.exports = {
  WebhookVerifier, // exported for unit testing — do not use in production code
  logAuthorizeEvent, // exported for unit testing
  plisioWebhook,
  paymentsCloudWebhook
};
