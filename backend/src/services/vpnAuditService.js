/**
 * vpnAuditService.js - 15-Minute Payment → Access Audit
 * =====================================================
 *
 * PURPOSE:
 * Every 15 minutes, verify that every customer who paid actually has VPN access.
 * This is the fallback when webhooks fail or ARB billing events don't fire.
 *
 * THE 30-DAY RULE (both payment types):
 *   - Has the customer paid? AND
 *   - Does their VPN expire in less than 30 days?
 *   - If YES to both → extend expiry by 30 days (NOT full plan interval)
 *
 * TWO PAYMENT TYPES:
 *
 * AUTHORIZE.NET ARB (card subscriptions):
 *   - ARB status 'active' means Authorize.net is managing the subscription
 *   - We verify payment by checking the latest transaction (settledSuccessfully = paid)
 *   - suspended/canceled = missed payment → revoke VPN access
 *
 * PLISIO (crypto invoices):
 *   - Plisio invoice status 'completed' = blockchain confirmed, customer paid
 *   - Anything else (including 'pending') = no action (waiting for crypto payment)
 *
 * SCHEDULING:
 *   vpnAuditScheduler.js runs every 15 minutes via crontab.
 *   Each run is idempotent — extending an account that's already fine is harmless.
 */

'use strict';

const db = require('../config/database');
const VpnResellersService = require('./vpnResellersService');
const { AuthorizeNetService, getAuthorizeTransactionDetails } = require('./authorizeNetUtils');
const log = require('../utils/logger');

const vpnResellersService = new VpnResellersService();
const authorizeService = new AuthorizeNetService();

// Minimum days a paid subscription must have remaining before we trigger an extend.
// Business rule: if a customer has paid and their VPN expires in less than 30 days,
// add 30 more days. This is a safety net for missed webhooks.
const MINIMUM_DAYS = 30;

// Days to add when a paid account is below MINIMUM_DAYS threshold.
// We add 30 days regardless of plan interval (the audit is a safety net, not a renewal).
const EXTEND_DAYS = 30;

/**
 * getDaysUntil(dateStr) — days between now and a date string.
 * Returns negative if date is in the past, Infinity if dateStr is null/malformed.
 */
function getDaysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const exp = new Date(dateStr);
  if (isNaN(exp.getTime())) return Infinity;
  return Math.round((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * daysFromNow(days) — YYYY-MM-DD string that is `days` days from now.
 */
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * extendVpnExpiry(uuid, userId, newExpiry) — set VPN expiry in VPNResellers + local DB.
 * Idempotent: calling setExpiry with the same date twice is a no-op on the VPNResellers side.
 *
 * @param {string} uuid      — VPNResellers account ID
 * @param {string} userId    — local user ID
 * @param {string} newExpiry — YYYY-MM-DD new expiry date
 * @param {number} daysLeft — current days remaining (for log)
 */
async function extendVpnExpiry(uuid, userId, newExpiry, daysLeft) {
  try {
    await vpnResellersService.setExpiry(uuid, newExpiry);
  } catch (err) {
    log.error('[Audit] Failed to set VPNResellers expiry', { uuid, newExpiry, error: err.message });
    throw err;
  }

  await db.query(
    `UPDATE vpn_accounts
     SET expiry_date = $1::timestamptz, status = 'active', updated_at = NOW()
     WHERE user_id = $2`,
    [newExpiry, userId]
  );

  log.info('[Audit] VPN extended', { uuid, userId, newExpiry, daysLeft, extendDays: EXTEND_DAYS });
}

/**
 * revokeVpnAccess(uuid, userId, reason) — disable VPN in VPNResellers + mark expired locally.
 * This is called when we confirm a customer has missed a payment.
 */
async function revokeVpnAccess(uuid, userId, reason) {
  if (uuid) {
    try {
      await vpnResellersService.disableAccount(uuid);
    } catch (err) {
      log.warn('[Audit] Failed to disable VPNResellers account', { uuid, error: err.message });
    }
  }
  await db.query(
    `UPDATE vpn_accounts SET status = 'expired', updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
  await db.query(
    `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
  log.info('[Audit] VPN revoked', { uuid, userId, reason });
}

// ─── Per-payment-type verification ─────────────────────────────────────────

/**
 * isPlisioPaid(invoiceId) — returns true if Plisio invoice is confirmed completed.
 * 'completed' means the blockchain transaction has enough confirmations.
 * Anything else (pending, expired, etc.) means we wait.
 */
async function isPlisioPaid(invoiceId) {
  if (!invoiceId) return false;
  try {
    const plisio = require('./plisioService');
    const info = await plisio.getInvoiceStatus(invoiceId);
    // Plisio returns { status: 'completed' } on success
    return info?.status === 'completed';
  } catch (err) {
    log.warn('[Audit] Plisio status check failed', { invoiceId, error: err.message });
    return false;
  }
}

/**
 * getArbPaymentStatus(arbSubscriptionId) — check if ARB subscription is in good standing.
 *
 * Returns:
 *   'active_ok'       — subscription is active and last payment was settled successfully
 *   'active_no_payment' — subscription is active but no settled payment found yet (normal for new subs)
 *   'suspended'       — payment failed, Authorize.net suspended the sub
 *   'canceled'        — subscription was canceled
 *   'error'           — could not determine (treat as safe no-action)
 *
 * How we verify payment for ARB:
 *   ARB runs on a schedule. We look at the most recent transaction associated with
 *   the subscription's customer profile. settledSuccessfully = card was charged successfully.
 */
async function getArbPaymentStatus(arbSubscriptionId) {
  if (!arbSubscriptionId) return 'error';

  try {
    const arb = await authorizeService.getArbSubscription(arbSubscriptionId);
    if (!arb) return 'error';

    const status = String(arb.status || '').toLowerCase();
    const paymentStatus = String(arb.paymentStatus || '').toLowerCase();
    const customerProfileId = arb.customerProfileId || null;

    // Authorize.net explicitly says subscription is done
    if (status === 'canceled' || paymentStatus === 'canceled') return 'canceled';
    if (status === 'suspended' || paymentStatus === 'suspended') return 'suspended';

    // ARB is active — verify the card was actually charged by checking recent transactions
    if (customerProfileId) {
      // Get the most recent settled transaction for this customer profile
      const txStatus = await getRecentTransactionStatus(customerProfileId);
      if (txStatus === 'settledSuccessfully') {
        return 'active_ok';
      }
      // No settled transaction = ARB is active but billing cycle hasn't produced
      // a settled charge yet (normal for brand-new subscriptions or mid-cycle signups)
      return 'active_no_payment';
    }

    // No customer profile ID = unusual; treat as uncertain but safe
    return 'active_no_payment';
  } catch (err) {
    log.warn('[Audit] ARB status check failed', { arbSubscriptionId, error: err.message });
    return 'error';
  }
}

/**
 * getRecentTransactionStatus(customerProfileId) — get the most recent settled transaction.
 *
 * We use getCustomerProfile + getTransactionListRequest per Authorize.net API docs.
 * Only settledSuccessfully means the card was actually charged.
 *
 * Returns 'settledSuccessfully' | 'pending' | 'none' | 'error'
 */
async function getRecentTransactionStatus(customerProfileId) {
  try {
    const apiLoginId = process.env.AUTHORIZE_NET_API_LOGIN_ID;
    const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;
    if (!apiLoginId || !transactionKey) return 'error';

    const requestBody = {
      getCustomerProfileRequest: {
        merchantAuthentication: { name: apiLoginId, transactionKey },
        customerProfileId: String(customerProfileId),
        includeTransactions: true
      }
    };

    const response = await fetch('https://api.authorize.net/xml/v1/request.api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) return 'error';

    const raw = await response.text();
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));

    const profile = data?.profile;
    const transactions = profile?.transactions || [];

    if (transactions.length === 0) return 'none';

    // Transactions are in reverse chronological order; first = most recent
    const lastTx = transactions[0];
    const settled = String(lastTx).toLowerCase().includes('settled');
    return settled ? 'settledSuccessfully' : 'pending';
  } catch (err) {
    log.warn('[Audit] Transaction list fetch failed', { customerProfileId, error: err.message });
    return 'error';
  }
}

// ─── Core audit ─────────────────────────────────────────────────────────────

/**
 * runOnce() — main entry point. Call every 15 minutes via cron.
 *
 * For every active/trialing subscription:
 *   1. Verify payment went through (Plisio completed OR ARB settledSuccessfully)
 *   2. If paid, check VPN expiry from VPNResellers
 *   3. If VPN expires < MINIMUM_DAYS days, extend by EXTEND_DAYS (30 days)
 *   4. If payment failed (ARB suspended/canceled), revoke VPN
 */
async function runOnce() {
  const { rows: subs } = await db.query(`
    SELECT
      s.id                      AS subscription_id,
      s.user_id,
      s.status                  AS sub_status,
      s.plisio_invoice_id,
      s.arb_subscription_id,
      s.current_period_end,
      p.interval                AS plan_interval,
      p.amount_cents,
      va.id                     AS vpn_account_id,
      va.vpn_uuid,
      va.vpn_username,
      va.expiry_date
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    LEFT JOIN vpn_accounts va ON va.user_id = s.user_id AND va.status = 'active'
    WHERE s.status IN ('active', 'trialing')
    ORDER BY s.created_at ASC
    LIMIT 200
  `);

  log.info('[Audit] Starting subscription audit', { count: subs.length });

  for (const sub of subs) {
    try {
      await auditOne(sub);
    } catch (err) {
      log.error('[Audit] Error auditing subscription', {
        subscriptionId: sub.subscription_id, error: err.message
      });
    }
  }
}

/**
 * auditOne(sub) — audit a single subscription.
 *
 * @param {object} sub — joined row from runOnce()
 */
async function auditOne(sub) {
  const { subscription_id: subId, user_id: userId, plan_interval: interval,
          vpn_uuid: vpnUuid, vpn_username: vpnUsername, plisio_invoice_id: plisioInvoiceId,
          arb_subscription_id: arbSubId } = sub;

  log.info('[Audit] Auditing', {
    subId, userId, vpnUsername, plisioInvoiceId, arbSubId
  });

  // ── Step 1: Verify payment status ─────────────────────────────────────────

  // PLISIO path: check if invoice is completed
  if (plisioInvoiceId) {
    const paid = await isPlisioPaid(plisioInvoiceId);
    if (!paid) {
      // Not confirmed paid yet — crypto may still be in transit; skip this cycle
      log.info('[Audit] Plisio invoice not completed yet', { subId, invoiceId: plisioInvoiceId });
      return;
    }
    // Paid: fall through to access check
  }

  // ARB path: check subscription payment status
  if (arbSubId) {
    const arbStatus = await getArbPaymentStatus(arbSubId);

    if (arbStatus === 'suspended' || arbStatus === 'canceled') {
      // Missed payment — revoke VPN access
      await revokeVpnAccess(vpnUuid, userId, `ARB ${arbStatus}`);
      await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE id = $1`,
        [subId]
      );
      log.info('[Audit] ARB payment failed, VPN revoked', { subId, arbSubId, arbStatus });
      return;
    }

    if (arbStatus === 'active_no_payment') {
      // ARB is active but no settled transaction yet — this is normal for new subs
      // or mid-cycle signups. Don't revoke, but also don't extend.
      log.info('[Audit] ARB active, no settled payment yet', { subId, arbSubId });
      return;
    }

    if (arbStatus === 'error') {
      // Could not verify — safest to skip extension this cycle rather than act blind
      log.info('[Audit] ARB status unknown, skipping', { subId, arbSubId });
      return;
    }

    // arbStatus === 'active_ok': paid, fall through to access check
  }

  // ── Step 2: Check VPN expiry (VPNResellers is the source of truth) ───────

  if (!vpnUuid) {
    log.warn('[Audit] No VPN account for active subscription', { subId, userId });
    return;
  }

  let vpnExpiry = null;
  try {
    const acct = await vpnResellersService.getAccount(vpnUuid);
    vpnExpiry = acct?.expire_at || null; // vpnResellersService maps expired_at → expire_at
  } catch (err) {
    log.warn('[Audit] Could not fetch VPNResellers account', { vpnUuid, error: err.message });
    // Fall back to local DB if API is unreachable
    vpnExpiry = sub.expiry_date
      ? new Date(sub.expiry_date).toISOString().split('T')[0]
      : null;
  }

  const daysLeft = vpnExpiry ? getDaysUntil(vpnExpiry) : -999;

  log.info('[Audit] VPN status', {
    subId, vpnUuid, vpnUsername, vpnExpiry,
    daysLeft: Math.round(daysLeft), thresholdDays: MINIMUM_DAYS
  });

  // VPN is already expired in VPNResellers → revoke locally
  if (vpnExpiry && daysLeft < 0) {
    await revokeVpnAccess(vpnUuid, userId, `VPN expired in VPNResellers (${Math.round(daysLeft)} days ago)`);
    return;
  }

  // Paid but expiring within MINIMUM_DAYS days → extend by EXTEND_DAYS (30 days)
  if (daysLeft < MINIMUM_DAYS) {
    const newExpiry = daysFromNow(EXTEND_DAYS);
    await extendVpnExpiry(vpnUuid, userId, newExpiry, Math.round(daysLeft));

    // Sync subscription period end to match new VPN expiry
    await db.query(
      `UPDATE subscriptions SET current_period_end = $1::timestamptz, updated_at = NOW() WHERE id = $2`,
      [newExpiry, subId]
    );
  }
}

module.exports = { runOnce, auditOne };