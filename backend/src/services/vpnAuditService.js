/**
 * vpnAuditService.js — 15-Minute Payment → Access Audit
 * =====================================================
 *
 * PURPOSE:
 * Every 15 minutes, reconcile what customers paid against what access they should have.
 * This is the fallback when webhooks fail or ARB billing events don't fire properly.
 *
 * WORKFLOW PER SUBSCRIPTION:
 * 1. Get all active/trialing subscriptions (ARB card + Plisio crypto)
 * 2. For each sub, verify payment status from the processor
 * 3. Get the VPN account's actual expiry date from VPNResellers
 * 4. If paid-up AND expiry < NOW + 30 days → extend to NOW + plan_interval
 * 5. If expired/no-record → suspend VPN in VPNResellers + mark db
 *
 * TWO PAYMENT TYPES:
 *
 * AUTHORIZE.NET ARB (card):
 *   - ARB status pulled from Authorize.net API via getArbSubscription()
 *   - settledSuccessfully = paid → extend access
 *   - suspended/canceled = not paid → revoke access
 *
 * PLISIO (crypto):
 *   - Invoice status pulled from Plisio API via getInvoiceStatus()
 *   - completed = paid → extend access
 *   - anything else → no action (waiting for payment)
 *
 * THE 30-DAY RULE:
 *   "If paid and expires in less than 30 days → extend by one full plan period."
 *   This applies to both payment types consistently.
 *
 * SCHEDULING:
 *   vpnAccountScheduler.js runs runOnce() every 15 minutes.
 *   Each run is idempotent — calling extend twice with same date is fine.
 */

'use strict';

const db = require('../config/database');
const VpnResellersService = require('./vpnResellersService');
const { AuthorizeNetService } = require('./authorizeNetUtils');
const log = require('../utils/logger');

const vpnResellersService = new VpnResellersService();
const authorizeService = new AuthorizeNetService();

// Minimum days a paid subscription must have remaining before we trigger an extend.
// Set to 30 as per business rule: if paid and < 30 days left → extend.
const MINIMUM_DAYS = 30;

// Days to extend when audit detects < MINIMUM_DAYS remaining.
// This is the full plan interval, not an incremental top-up.
const EXTEND_DAYS = {
  month:  30,
  quarter: 90,
  semi_annual: 180,
  year:   365,
};

/**
 * getDaysUntil(dateStr) — parse a date string, return days until that date.
 * Returns a negative number if the date is in the past.
 */
function getDaysUntil(dateStr) {
  if (!dateStr) return Infinity; // no date = "never expires" = safe
  const exp = new Date(dateStr);
  if (isNaN(exp.getTime())) return Infinity;
  const now = Date.now();
  return Math.round((exp.getTime() - now) / (1000 * 60 * 60 * 24));
}

/**
 * addDays(dateStr, days) — return a new ISO date string (YYYY-MM-DD) that is `days`
 * days after the given date string, or NOW + days if dateStr is null/falsy.
 */
function addDaysToDate(dateStr, days) {
  const base = dateStr ? new Date(dateStr) : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * getPlanIntervalDays(interval) — map plan interval string to extension days.
 */
function getPlanIntervalDays(interval) {
  const key = String(interval || '').toLowerCase();
  return EXTEND_DAYS[key] || EXTEND_DAYS.month;
}

/**
 * extendVpnExpiry — calls VPNResellers setExpiry + updates local vpn_accounts table.
 * Idempotent: if the account is already extended to (or past) the target date,
 * calling setExpiry again with the same target is a no-op from the API side.
 *
 * @param {string} vpnUuid    — VPNResellers account ID
 * @param {string} userId    — local user ID (for DB update)
 * @param {string} targetDate — YYYY-MM-DD target expiry
 * @param {string} reason    — why we're extending (for logging)
 */
async function extendVpnExpiry(vpnUuid, userId, targetDate, reason) {
  try {
    // Tell VPNResellers the new expiry
    await vpnResellersService.setExpiry(vpnUuid, targetDate);
  } catch (err) {
    log.error('[Audit] Failed to set VPNResellers expiry', { vpnUuid, targetDate, error: err.message });
    throw err;
  }

  // Sync the local DB record
  await db.query(
    `UPDATE vpn_accounts
     SET expiry_date = $1::timestamptz, status = 'active', updated_at = NOW()
     WHERE user_id = $2`,
    [targetDate, userId]
  );

  log.info('[Audit] VPN extended', { vpnUuid, userId, targetDate, reason });
}

/**
 * suspendVpnAccount — deactivate in VPNResellers and mark expired in DB.
 */
async function suspendVpnAccount(vpnUuid, userId) {
  if (vpnUuid) {
    try {
      await vpnResellersService.disableAccount(vpnUuid);
    } catch (err) {
      log.warn('[Audit] Failed to disable VPNResellers account', { vpnUuid, error: err.message });
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
  log.info('[Audit] VPN suspended (no valid payment)', { vpnUuid, userId });
}

/**
 * runOnce — main audit entry point. Call every 15 minutes via cron.
 *
 * PROCESSING STEPS:
 * 1. Pull all active/trialing subscriptions with their VPN accounts
 * 2. For each sub, determine payment status (ARB or Plisio)
 * 3. For each VPN account, compare expiry to NOW + MINIMUM_DAYS
 * 4. Extend or suspend as needed
 */
async function runOnce() {
  // ── 1. Pull all active/trialing subscriptions that have VPN accounts ───────
  const { rows: subs } = await db.query(`
    SELECT
      s.id        AS subscription_id,
      s.user_id,
      s.status    AS sub_status,
      s.plisio_invoice_id,
      s.arb_subscription_id,
      s.current_period_end,
      s.metadata,
      p.interval  AS plan_interval,
      p.amount_cents,
      va.id       AS vpn_account_id,
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

  log.info('[Audit] Checking subscriptions', { count: subs.length });

  // ── 2 & 3. Audit each subscription ─────────────────────────────────────────
  for (const sub of subs) {
    try {
      await auditSubscription(sub);
    } catch (err) {
      log.error('[Audit] Subscription error', { subscriptionId: sub.subscription_id, error: err.message });
    }
  }
}

/**
 * auditSubscription — audit a single subscription and its VPN account.
 *
 * @param {object} sub — joined subscription + vpn_account row from runOnce()
 */
async function auditSubscription(sub) {
  const { plan_interval: interval, vpn_uuid: vpnUuid, user_id: userId,
          subscription_id: subId, expiry_date: localExpiry } = sub;

  // ── Determine payment status ─────────────────────────────────────────────

  // PLISIO: crypto invoice
  if (sub.plisio_invoice_id) {
    const paid = await checkPlisioPaid(sub.plisio_invoice_id);
    if (!paid) {
      // Crypto invoice not confirmed — waiting for blockchain payment, skip
      return;
    }
    // Paid: fall through to access check
  }

  // AUTHORIZE.NET ARB: card subscription
  if (sub.arb_subscription_id) {
    const arbStatus = await checkArbStatus(sub.arb_subscription_id);
    if (arbStatus === 'canceled' || arbStatus === 'suspended') {
      // Missed payment — revoke VPN access
      if (vpnUuid) {
        await suspendVpnAccount(vpnUuid, userId);
      }
      await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE id = $1`,
        [subId]
      );
      log.info('[Audit] ARB canceled, VPN revoked', { subId, arbStatus });
      return;
    }
    if (arbStatus !== 'settledSuccessfully') {
      // Any other ARB status (active but not settled yet) — skip extension for now
      // settledSuccessfully is the definitive "payment succeeded" event
      return;
    }
    // Paid: fall through to access check
  }

  // ── Access check: does VPN account have enough time? ───────────────────────

  // Pull the authoritative expiry from VPNResellers (source of truth)
  let vpnResellersExpiry = null;
  if (vpnUuid) {
    try {
      const acct = await vpnResellersService.getAccount(vpnUuid);
      vpnResellersExpiry = acct?.expire_at || null;
    } catch (err) {
      log.warn('[Audit] Could not fetch VPNResellers expiry', { vpnUuid, error: err.message });
    }
  }

  // Use VPNResellers expiry as the source of truth; fall back to local DB
  const effectiveExpiry = vpnResellersExpiry || (localExpiry ? new Date(localExpiry).toISOString().split('T')[0] : null);
  const daysLeft = vpnResellersExpiry
    ? getDaysUntil(vpnResellersExpiry)
    : (localExpiry ? getDaysUntil(new Date(localExpiry).toISOString()) : Infinity);

  log.info('[Audit] Sub audit', {
    subId,
    vpnUuid,
    vpnUsername: sub.vpn_username,
    effectiveExpiry,
    daysLeft: Math.round(daysLeft),
    planInterval: interval
  });

  if (!vpnUuid) {
    // No VPN account exists — create one if subscription is fully paid
    // (This handles cases where webhook activated subscription but VPN wasn't provisioned)
    log.warn('[Audit] No VPN account for active subscription', { subId, userId });
    return;
  }

  if (daysLeft < MINIMUM_DAYS) {
    // Paid but expiring soon → extend by one full plan period
    const extendDays = getPlanIntervalDays(interval);
    const targetDate = addDaysToDate(null, extendDays);

    await extendVpnExpiry(vpnUuid, userId, targetDate,
      `audit: only ${Math.round(daysLeft)} days left (min ${MINIMUM_DAYS}), extending ${extendDays} days`
    );

    // Also update the subscription period end to match
    const newPeriodEnd = addDaysToDate(null, extendDays);
    await db.query(
      `UPDATE subscriptions SET current_period_end = $1::timestamptz, updated_at = NOW() WHERE id = $2`,
      [newPeriodEnd, subId]
    );
  }

  // If VPN is expired in VPNResellers but not yet marked in DB → suspend
  if (vpnResellersExpiry && daysLeft < 0) {
    await suspendVpnAccount(vpnUuid, userId);
    log.info('[Audit] VPN expired (negative days), suspended', { vpnUuid });
  }
}

/**
 * checkPlisioPaid — returns true if the Plisio invoice is confirmed paid.
 * Only 'completed' status means the customer has paid and should have access.
 */
async function checkPlisioPaid(invoiceId) {
  try {
    const { PlisioService } = require('./plisioService');
    const plisioService = new PlisioService();
    const status = await plisioService.getInvoiceStatus(invoiceId);
    return status?.status === 'completed';
  } catch (err) {
    log.warn('[Audit] Plisio status check failed', { invoiceId, error: err.message });
    return false;
  }
}

/**
 * checkArbStatus — returns the ARB payment status string from Authorize.net.
 * Returns 'suspended', 'canceled', 'settledSuccessfully', or null (unknown/no payment yet).
 * Returns null for 'active' ARB subscriptions with no new payment (ARB processes on schedule).
 */
async function checkArbStatus(arbSubscriptionId) {
  try {
    const arb = await authorizeService.getArbSubscription(arbSubscriptionId);
    if (!arb) return null;

    const status = String(arb.status || '').toLowerCase();
    const paymentStatus = arb.paymentStatus || '';

    if (status === 'canceled' || paymentStatus === 'canceled') return 'canceled';
    if (status === 'suspended' || paymentStatus === 'suspended') return 'suspended';
    if (paymentStatus === 'settledSuccessfully') return 'settledSuccessfully';

    // ARB is active but no new payment has settled — that's ok, no action needed
    return null;
  } catch (err) {
    log.warn('[Audit] ARB status check failed', { arbSubscriptionId, error: err.message });
    return null;
  }
}

module.exports = { runOnce, auditSubscription };