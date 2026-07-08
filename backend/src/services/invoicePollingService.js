/**
 * invoicePollingService.js — Crypto & ARB Payment Polling Engine
 * ==============================================================
 *
 * PURPOSE:
 * This service is the heartbeat of AhoyVPN's off-site payment flows. When a
 * customer pays with cryptocurrency (via Plisio) or has a recurring billing
 * agreement (via Authorize.net ARB), the payment processor notifies us via
 * webhooks — but webhooks can fail, arrive late, or be missed entirely. This
 * polling service acts as a reliable fallback: it continuously checks payment
 * status so customers get access to their VPN even when webhooks are unreliable.
 *
 * TWO SEPARATE POLLING LOOPS:
 *
 * 1. PLISIO CRYPTO POLLING (runOnce)
 *    Customers who pay with crypto enter a "trialing" subscription while we wait
 *    for the blockchain transaction to confirm. runOnce() polls Plisio's API at
 *    three checkpoints (15, 30, 45 minutes) to detect when the invoice is paid.
 *    When confirmed, it calls processPlisioPaymentAsync() which:
 *      - Verifies the transaction against Plisio's API
 *      - Creates/extends the VPN account
 *      - Emails credentials to the customer
 *      - Records the affiliate commission
 *      - Sets the subscription to "active"
 *
 *    If the customer never pays, the invoice eventually times out and the
 *    trialing subscription remains orphaned (no VPN access, no charge). This is
 *    intentional — we don't cancel the subscription, we just wait for payment.
 *    William may want a cleanup job to expire old trialing subscriptions later.
 *
 * 2. AUTHORIZE.NET ARB POLLING (pollArbSubscriptions)
 *    ARB subscriptions are for card payments with recurring billing. Unlike
 *    Plisio's webhook-for-everything model, ARB subscriptions exist server-side
 *    at Authorize.net — we must actively poll to know if a payment succeeded.
 *    This loop:
 *      - Finds all active/trialing ARB subscriptions last updated >5 min ago
 *      - Calls Authorize.net's ARB API to get the current subscription status
 *      - If payment succeeded: activates the subscription + enables VPN
 *      - If suspended/canceled: deactivates VPN + marks subscription canceled
 *
 * WHY SEPARATE LOOPS?
 * Plisio and Authorize.net have completely different APIs, data models, and
 * state semantics. Polling them separately keeps each loop simple and testable.
 * They could theoretically be merged, but the benefit is unclear.
 *
 * SCHEDULING:
 * vpnAccountScheduler.js runs runOnce() and pollArbSubscriptions() on an
 * interval (typically every 5 minutes). The 5-minute gap between checks means
 * the worst case for payment confirmation is ~5 minutes after the blockchain
 * or ARB server confirms the payment.
 *
 * DESIGN DECISIONS:
 * - Checkpoint tracking via subscription.metadata (not a separate table) keeps
 *   polling state self-contained. If the subscription row is deleted, polling
 *   state goes away too — acceptable tradeoff for simplicity.
 * - Individual subscription errors are caught inside the loop so one bad
 *   subscription (bad data, network glitch, etc.) doesn't abort the entire run.
 *   This is explicitly a "best-effort per subscription" design.
 * - Outer try/catch re-throws catastrophic errors (DB down, etc.) so the
 *   scheduler can log the failure and retry. A crash in the inner loop just
 *   logs and continues.
 * - _authorizeService is lazy-loaded and cached at module level to avoid
 *   importing before mocks are set up in tests. _resetAuthorizeService() is
 *   called in beforeEach to ensure each test gets a fresh instance.
 */

'use strict';

const db = require('../config/database');
const plisioService = require('./plisioService');
const VpnResellersService = require('./vpnResellersService');
const { processPlisioPaymentAsync } = require('./paymentProcessingService');
const log = require('../utils/logger');

const vpnResellersService = new VpnResellersService();

// Checkpoint minutes for Plisio crypto invoice polling.
// After 45 minutes with no payment, the invoice is considered abandoned.
// The runOnce() loop evaluates subscriptions every 5 minutes, so these
// checkpoints are approximate — a subscription may wait up to 10 minutes past
// its checkpoint before the next polling run picks it up.
const CHECKPOINT_MINUTES = [15, 30, 45];

function getAttempts(metadata) {
  const attempts = Number(metadata?.poll_attempts || 0);
  return Number.isFinite(attempts) && attempts >= 0 ? attempts : 0;
}

function mergeMetadata(existing, patch) {
  return { ...(existing || {}), ...patch };
}

async function updateMetadata(subscriptionId, metadata) {
  await db.query(
    `UPDATE subscriptions
     SET metadata = $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(metadata || {}), subscriptionId]
  );
}

/**
 * runOnce — Poll Plisio crypto invoices for "trialing" subscriptions.
 *
 * POLLING STRATEGY:
 * Every subscription with status='trialing' and a plisio_invoice_id is checked.
 * We track poll_attempts in subscription.metadata, advancing through checkpoints.
 * On the 4th attempt (past all checkpoints), the invoice is considered abandoned.
 *
 * PAYMENT CONFIRMATION FLOW:
 * When Plisio reports status='completed':
 *   → processPlisioPaymentAsync() handles everything: VPN account, email, commission
 *   → The subscription is marked completed and VPN is activated
 *
 * INVOICE SWITCHING:
 * Plisio may "switch" an invoice if the customer overpays and is credited to a new
 * invoice. The code handles this via activeInvoiceId — if the original invoice is
 * 'cancelled duplicate' but has an active_invoice_id, we process that instead.
 *
 * @returns {Promise<void>} — Throws on catastrophic failure (DB down, etc.)
 */
async function runOnce() {
  const { rows } = await db.query(`
    SELECT id, user_id, status, plisio_invoice_id, metadata, created_at
    FROM subscriptions
    WHERE status = 'trialing'
      AND plisio_invoice_id IS NOT NULL
      AND created_at > NOW() - INTERVAL '3 days'
    ORDER BY created_at ASC
    LIMIT 100
  `);

  try {
    for (const sub of rows) {
      try {
        const metadata = sub.metadata || {};
        const attempts = getAttempts(metadata);
        if (attempts >= CHECKPOINT_MINUTES.length) {
          continue;
        }

        const ageMinutes = Math.floor((Date.now() - new Date(sub.created_at).getTime()) / 60000);
        const nextCheckpoint = CHECKPOINT_MINUTES[attempts];
        if (ageMinutes < nextCheckpoint) {
          continue;
        }

        const statusResp = await plisioService.getInvoiceStatus(sub.plisio_invoice_id);
        const invoice = statusResp?.invoice || statusResp || {};
        const invoiceStatus = String(invoice.status || '').toLowerCase();
        const activeInvoiceId = statusResp?.active_invoice_id || invoice?.paid_id || invoice?.switch_id || null;

        const baseMeta = mergeMetadata(metadata, {
          last_poll_at: new Date().toISOString(),
          poll_attempts: attempts + 1,
          last_polled_invoice_id: sub.plisio_invoice_id,
          last_polled_status: invoice.status || null
        });

        if (invoiceStatus === 'completed') {
          await processPlisioPaymentAsync(
            sub.plisio_invoice_id,
            (invoice.tx_id && invoice.tx_id[0]) || invoice.txid || null,
            invoice.amount || invoice.invoice_total_sum || null,
            invoice.currency || invoice.psys_cid || null
          );

          await updateMetadata(sub.id, mergeMetadata(baseMeta, {
            poll_result: 'completed',
            completed_at: new Date().toISOString()
          }));
          continue;
        }

        if (invoiceStatus.startsWith('cancelled duplicate') && activeInvoiceId) {
          await processPlisioPaymentAsync(
            activeInvoiceId,
            (invoice.tx_id && invoice.tx_id[0]) || invoice.txid || null,
            invoice.amount || invoice.invoice_total_sum || null,
            invoice.currency || invoice.psys_cid || null
          );

          await updateMetadata(sub.id, mergeMetadata(baseMeta, {
            poll_result: 'completed_via_active_invoice',
            switched_to_invoice_id: activeInvoiceId,
            completed_at: new Date().toISOString()
          }));
          continue;
        }

        if (attempts + 1 >= CHECKPOINT_MINUTES.length) {
          await updateMetadata(sub.id, mergeMetadata(baseMeta, {
            poll_result: 'timeout_no_payment',
            polling_stopped_at: new Date().toISOString()
          }));
        } else {
          await updateMetadata(sub.id, baseMeta);
        }
      } catch (error) {
        // Inner catch: one bad subscription doesn't stop the polling run.
        // Log and continue to next subscription.
        log.error('Invoice polling error for subscription', { subscriptionId: sub.id, error: error.message || error });
      }
    }
  } catch (error) {
    // Outer catch: catastrophic failure (DB error, logger crash, unhandled rejection).
    // Re-throw so the scheduler can retry the entire run.
    log.error('Invoice polling run failed catastrophically', { error: error.message || error });
    throw error;
  }
}
/**
 * pollArbSubscriptions — Poll Authorize.net ARB subscriptions for payment events.
 *
 * ARB (Automated Recurring Billing) is Authorize.net's recurring payment product.
 * Unlike Plisio (which pushes webhook events), ARB requires us to PULL status.
 * Authorize.net maintains the subscription server-side; we only learn of events
 * by actively querying their API.
 *
 * WHAT THIS DETECTS:
 * - ARB suspended/canceled: customer missed a payment → VPN should be suspended
 * - ARB settledSuccessfully: payment collected → VPN should be activated/extended
 *
 * ARB → VPN LIFECYCLE:
 *   Customer pays → webhook creates ARB subscription (no VPN yet, status=trialing)
 *   → pollArbSubscriptions detects settledSuccessfully → activates VPN
 *   → monthly ARB charge fires → webhook receives payment → extends VPN expiry
 *   → ARB fails/cancels → pollArbSubscriptions detects → suspends VPN
 *
 * THE 5-MINUTE UPDATE THROTTLE:
 * Subscriptions are only polled if updated_at < NOW() - INTERVAL '5 minutes'.
 * This prevents hammering the ARB API on every scheduler tick. If a webhook
 * fires and updates the subscription row, it won't be polled for another 5 min.
 * This is fine because the webhook already handled the payment event.
 *
 * @param {object} opts - Test injection: { authorizeService }
 * @returns {Promise<void>}
 */
module.exports = {
  runOnce,
  CHECKPOINT_MINUTES
};
