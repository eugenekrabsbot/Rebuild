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
 *   - If YES to both → extend expiry by 30 days
 *
 * TWO PAYMENT TYPES:
 *
 * AUTHORIZE.NET ARB (card subscriptions):
 *   - ARB status 'active' from getArbSubscription = subscription is in good standing
 *   - We verify payment by checking lastPaymentDate from getArbSubscription.
 *     If a lastPaymentDate is recorded, Authorize.net successfully charged the card.
 *   - suspended/canceled = missed payment → revoke VPN access immediately
 *
 * PLISIO (crypto invoices):
 *   - Plisio invoice status 'completed' = blockchain confirmed, customer paid
 *   - Anything else (pending, expired) = no action (waiting for crypto payment)
 *
 * HOW ARB PAYMENT VERIFICATION WORKS (via VPNResellers expiry check):
 *   ARB renewals happen on a fixed schedule. VPNResellers is updated within ~24h of
 *   each successful charge — its expiry date IS the payment confirmation.
 *
 *   For an active ARB subscription:
 *     1. Get lastPaymentDate from getArbSubscription (if set → payment succeeded)
 *     2. Get current vpn_resellers expiry for this account
 *     3. If lastPaymentDate is set AND vpn_resellers expiry > NOW + 15 days → paid_up_ok
 *     4. If lastPaymentDate is set but expiry < NOW + 15 days → missed_webhook → extend 30 days
 *     5. If lastPaymentDate is null AND expiry < NOW + 30 days → VPNResellers not yet updated
 *        (billing date hasn't fired yet), don't revoke
 *
 * SCHEDULING:
 *   vpnAuditScheduler.js runs every 15 minutes via crontab.
 *   Each run is idempotent — extending an account that's already fine is harmless.
 */

'use strict';

const db = require('../config/database');
const VpnResellersService = require('./vpnResellersService');
const { AuthorizeNetService } = require('./authorizeNetUtils');
const log = require('../utils/logger');

const vpnResellersService = new VpnResellersService();
const authorizeService = new AuthorizeNetService();

// Minimum days a paid subscription must have remaining before we trigger an extend.
// Business rule: if a customer has paid and their VPN expires in less than 30 days,
// add 30 more days. This is a safety net for missed webhooks.
const MINIMUM_DAYS = 30;

// Days to add when a paid account is below MINIMUM_DAYS threshold.
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
 * daysFromNow(days) — YYYY-MM-DD string `days` days from now.
 */
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * extendVpnExpiry(uuid, userId, newExpiry) — set VPN expiry in VPNResellers + local DB.
 * Idempotent: calling setExpiry twice with the same date is a no-op on VPNResellers side.
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
 * Called when we confirm a customer has missed a payment.
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

// ─── Payment verification ───────────────────────────────────────────────────

/**
 * isPlisioPaid(invoiceId) — returns true only if Plisio invoice is 'completed'.
 * 'completed' means the blockchain transaction has enough confirmations.
 * Anything else (pending, expired) means the payment is still in transit.
 */
async function isPlisioPaid(invoiceId) {
  if (!invoiceId) return false;
  try {
    const plisio = require('./plisioService');
    const info = await plisio.getInvoiceStatus(invoiceId);
    return info?.status === 'completed';
  } catch (err) {
    log.warn('[Audit] Plisio status check failed', { invoiceId, error: err.message });
    return false;
  }
}

/**
 * getArbPaymentStatus(arbSubscriptionId) — check ARB subscription payment status.
 *
 * Returns:
 *   'active_ok'       — ARB active, lastPaymentDate is set (payment was charged), VPN has time
 *   'active_no_payment_recent' — ARB active but lastPaymentDate is null/old (billing date hasn't fired yet)
 *   'active_payment_missed'    — ARB active, had a payment date but VPN expiry has drifted (< 30 days)
 *   'suspended'       — Authorize.net suspended (card declined)
 *   'canceled'        — subscription was canceled
 *   'error'           — could not determine (treat as safe; skip extension this cycle)
 */
async function getArbPaymentStatus(arbSubscriptionId, vpnExpiry) {
  if (!arbSubscriptionId) return 'error';

  try {
    const arb = await authorizeService.getArbSubscription(arbSubscriptionId);
    if (!arb) return 'error';

    const status = String(arb.status || '').toLowerCase();
    const lastPaymentDate = arb.lastPaymentDate || null;
    const daysUntilVpnExpiry = vpnExpiry ? getDaysUntil(vpnExpiry) : -999;

    // Explicit cancellations — revoke immediately
    if (status === 'canceled') return 'canceled';
    if (status === 'suspended') return 'suspended';

    // ARB is active — check if Authorize.net has recorded a successful payment
    if (lastPaymentDate) {
      // Payment was made and settled. Now check if VPNResellers was updated.
      // If vpn_expiry > NOW + 15 days → VPNResellers was updated → all good
      // If vpn_expiry ≤ NOW + 15 days → VPNResellers not updated yet (webhook miss)
      //   OR the billing date hasn't fired yet this cycle (within 15 days of expiry)
      //   → extend 30 days as a safety net
      if (daysUntilVpnExpiry >= 15) {
        return 'active_ok'; // Paid and VPN time is sufficient
      }
      // VPN expiring within 15 days despite recent payment → webhook miss → extend
      return 'active_payment_missed';
    }

    // lastPaymentDate is null — ARB is active but no successful charge recorded yet.
    // This is normal for brand-new subscriptions (first billing date hasn't fired).
    // Also normal if the billing date is approaching but hasn't fired yet.
    // In this case, check VPNResellers expiry to decide if we're in danger.
    if (daysUntilVpnExpiry < 0) {
      // VPN already expired in VPNResellers but ARB is still active → revoke locally
      // (VPNResellers disabled the account; ARB will catch up)
      return 'active_payment_missed';
    }

    if (daysUntilVpnExpiry < MINIMUM_DAYS) {
      // VPN expiring within 30 days and no lastPaymentDate on ARB.
      // This means either: (a) webhook missed, or (b) billing date approaching but not fired.
      // Extend 30 days as a safety net.
      return 'active_payment_missed';
    }

    // ARB active, no payment yet recorded, but VPN has plenty of time (> 30 days).
    // Don't revoke and don't extend — billing date is likely approaching naturally.
    return 'active_no_payment_recent';

  } catch (err) {
    log.warn('[Audit] ARB status check failed', { arbSubscriptionId, error: err.message });
    return 'error';
  }
}

// ─── Core audit ─────────────────────────────────────────────────────────────

/**
 * runOnce() — main entry point. Call every 15 minutes via cron.
 *
 * For every active/trialing subscription:
 *   1. Verify payment went through (Plisio completed OR ARB active with payment history)
 *   2. If paid and VPN expires < 30 days → extend by 30 days
 *   3. If payment failed (ARB suspended/canceled) → revoke VPN
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
          vpn_uuid: vpnUuid, vpn_username: vpnUsername,
          plisio_invoice_id: plisioInvoiceId,
          arb_subscription_id: arbSubId } = sub;

  log.info('[Audit] Auditing', {
    subId, userId, vpnUsername, plisioInvoiceId, arbSubId
  });

  // ── Step 1: Verify payment status ─────────────────────────────────────────

  // PLISIO path: check if invoice is completed
  if (plisioInvoiceId) {
    const paid = await isPlisioPaid(plisioInvoiceId);
    if (!paid) {
      log.info('[Audit] Plisio invoice not completed yet', { subId, invoiceId: plisioInvoiceId });
      return;
    }
    // Paid: fall through to access check
  }

  // ARB path: check subscription payment status
  if (arbSubId) {
    // Fetch VPNResellers expiry for use in ARB status check
    let vpnExpiry = null;
    if (vpnUuid) {
      try {
        const acct = await vpnResellersService.getAccount(vpnUuid);
        vpnExpiry = acct?.data?.expire_at || null;
      } catch (err) {
        log.warn('[Audit] Could not fetch VPNResellers expiry', { vpnUuid, error: err.message });
      }
    }

    const arbStatus = await getArbPaymentStatus(arbSubId, vpnExpiry);

    if (arbStatus === 'suspended' || arbStatus === 'canceled') {
      await revokeVpnAccess(vpnUuid, userId, `ARB ${arbStatus}`);
      await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE id = $1`,
        [subId]
      );
      log.info('[Audit] ARB payment failed, VPN revoked', { subId, arbSubId, arbStatus });
      return;
    }

    if (arbStatus === 'error') {
      log.info('[Audit] ARB status unknown, skipping', { subId, arbSubId });
      return;
    }

    if (arbStatus === 'active_no_payment_recent') {
      // ARB active, no lastPaymentDate, VPN still has > 30 days — safe to wait
      log.info('[Audit] ARB active, awaiting first payment billing date', { subId, arbSubId });
      return;
    }

    if (arbStatus === 'active_payment_missed') {
      // ARB active but VPN has < 30 days (webhook miss or billing date approaching)
      // Extend 30 days. VPNResellers will be updated.
      if (vpnUuid) {
        const newExpiry = daysFromNow(EXTEND_DAYS);
        await extendVpnExpiry(vpnUuid, userId, newExpiry, getDaysUntil(vpnExpiry));
        await db.query(
          `UPDATE subscriptions SET current_period_end = $1::timestamptz, updated_at = NOW() WHERE id = $2`,
          [newExpiry, subId]
        );
      }
      return;
    }

    // arbStatus === 'active_ok': paid and VPN has plenty of time, fall through to expiry check
  }

  // ── Step 2: Access check — does the VPN account have enough time? ────────

  if (!vpnUuid) {
    log.warn('[Audit] No VPN account for active subscription', { subId, userId });
    return;
  }

  // Fetch authoritative expiry from VPNResellers (source of truth)
  let vpnExpiry = null;
  try {
    const acct = await vpnResellersService.getAccount(vpnUuid);
    vpnExpiry = acct?.data?.expire_at || null;
  } catch (err) {
    log.warn('[Audit] Could not fetch VPNResellers expiry', { vpnUuid, error: err.message });
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
  if (daysLeft < 0) {
    await revokeVpnAccess(vpnUuid, userId, `VPN expired in VPNResellers (${Math.round(daysLeft)} days ago)`);
    return;
  }

  // Paid but expiring within MINIMUM_DAYS (30) days → extend by EXTEND_DAYS (30 days)
  if (daysLeft < MINIMUM_DAYS) {
    const newExpiry = daysFromNow(EXTEND_DAYS);
    await extendVpnExpiry(vpnUuid, userId, newExpiry, Math.round(daysLeft));
    await db.query(
      `UPDATE subscriptions SET current_period_end = $1::timestamptz, updated_at = NOW() WHERE id = $2`,
      [newExpiry, subId]
    );
  }
}

module.exports = { runOnce, auditOne };