/**
 * vpnAuditService.js - Payment → Access Audit
 * ===========================================
 *
 * Runs every 15 minutes. Verifies that every customer who paid has working VPN access.
 *
 * TWO PAYMENT TYPES:
 *   Plisio (crypto)    — invoice status must be 'completed'
 *   Authorize.net ARB  — ARB status must be 'active' (suspended/canceled → revoke)
 *
 * ACCESS RULE:
 *   A paid subscription is entitled to VPN access for at least 30 days from the
 *   LAST RECORDED PAYMENT EVENT. We track this via last_extended_at on subscriptions.
 *
 *   - No last_extended_at + never extended before
 *     → anchor = GREATEST(subscription_created_at, current_period_end - 30 days)
 *     → if VPN expiry < anchor + 30 days → extend to anchor + 30 days
 *
 *   - Has last_extended_at (previously extended by this audit service)
 *     → if VPN expiry < last_extended_at + 30 days → extend to last_extended_at + 30 days
 *
 *   In plain English: "if you've paid and your VPN has fewer than 30 days remaining
 *   counting from your last payment date, add 30 days to your last payment date."
 *
 *   NOT: don't perpetually add 30 days to the current date.
 *
 * REVOCATION:
 *   - Plisio invoice is NOT completed + VPN account exists → revoke (waited too long)
 *   - ARB status is suspended OR canceled → revoke immediately
 *   - VPN account is expired in VPNResellers (expire_at < NOW) → revoke locally
 *
 * SCHEDULING:
 *   vpnAuditScheduler.js runs every 15 minutes via crontab.
 *   Each run is idempotent — setting the same expiry twice is harmless.
 */

'use strict';

const db = require('../config/database');
const VpnResellersService = require('./vpnResellersService');
const { AuthorizeNetService } = require('./authorizeNetUtils');
const log = require('../utils/logger');

const vpnResellersService = new VpnResellersService();
const authorizeService = new AuthorizeNetService();

// Business rule: paid customers are entitled to at least this many days of VPN access
// counting from their last payment event.
const MINIMUM_DAYS = 30;
const EXTEND_DAYS = 30; // always extend by this amount when needed

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Days between now and a YYYY-MM-DD date string. Negative = past. Infinity = null. */
function getDaysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const exp = new Date(dateStr);
  if (isNaN(exp.getTime())) return Infinity;
  return Math.round((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** YYYY-MM-DD string `days` days from today. */
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ─── Plisio ──────────────────────────────────────────────────────────────────

/** Returns true iff the Plisio invoice has status 'completed' (customer paid). */
async function isPlisioPaid(invoiceId) {
  if (!invoiceId) return false;
  try {
    // Plisio API v1 uses https://api.plisio.net/api/v1/invoices/{id}
    const resp = await fetch(`https://api.plisio.net/api/v1/invoices/${invoiceId}?api_key=${process.env.PLISIO_API_KEY}`);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.data?.status === 'completed';
  } catch (err) {
    log.warn('[Audit] Plisio status check failed', { invoiceId, error: err.message });
    return false;
  }
}

// ─── Authorize.net ARB ───────────────────────────────────────────────────────

/**
 * getArbPaymentStatus(arbSubscriptionId)
 *
 * Returns:
 *   'active'           — ARB is active, customer has paid (or billing date hasn't fired yet)
 *   'suspended'        — ARB suspended (card declined)
 *   'canceled'         — ARB canceled
 *   'error'            — could not determine (skip, don't revoke)
 *
 * For 'active', the caller must decide whether to extend based on VPN expiry.
 * We treat 'active' as "paid OR will-pay-soon" — we only revoke for suspended/canceled.
 * VPN expiry determines whether we need to add more time.
 */
async function getArbPaymentStatus(arbSubscriptionId) {
  if (!arbSubscriptionId) return 'error';
  try {
    const arb = await authorizeService.getArbSubscription(arbSubscriptionId);
    if (!arb) return 'error';
    const status = String(arb.status || '').toLowerCase();
    if (status === 'suspended') return 'suspended';
    if (status === 'canceled') return 'canceled';
    if (status === 'active') return 'active';
    // trial, expired, etc. — treat as active for safety (don't revoke)
    return 'active';
  } catch (err) {
    log.warn('[Audit] ARB status check failed', { arbSubscriptionId, error: err.message });
    return 'error';
  }
}

// ─── VPN extension / revocation ─────────────────────────────────────────────

/**
 * extendVpnExpiry(uuid, userId, newExpiry, daysLeft)
 *
 * Sets VPNResellers account expiry to newExpiry (YYYY-MM-DD).
 * Updates local vpn_accounts.expiry_date and subscriptions.current_period_end.
 * Sets subscriptions.last_extended_at = newExpiry (records the anchor point).
 */
async function extendVpnExpiry(uuid, userId, newExpiry, daysLeft) {
  if (!uuid) return;
  try {
    await vpnResellersService.setExpiry(uuid, newExpiry);
  } catch (err) {
    log.error('[Audit] Failed to extend VPNResellers expiry', { uuid, newExpiry, error: err.message });
    // Still update local DB even if VPNResellers call fails
  }

  await db.query(
    `UPDATE vpn_accounts SET expiry_date = $1::timestamptz, updated_at = NOW() WHERE vpn_uuid = $2`,
    [newExpiry, uuid]
  );

  await db.query(
    `UPDATE subscriptions
        SET current_period_end = $1::timestamptz,
            last_extended_at = $1::timestamptz,
            updated_at = NOW()
        WHERE user_id = $2 AND status IN ('active', 'trialing')`,
    [newExpiry, userId]
  );

  log.info('[Audit] VPN extended', { uuid, userId, newExpiry, daysLeft: Math.round(daysLeft) });
}

/**
 * revokeVpnAccess(uuid, userId, reason) — deactivate in VPNResellers + mark locally.
 */
async function revokeVpnAccess(uuid, userId, reason) {
  if (!uuid) return;
  try {
    await vpnResellersService.deactivateAccount({ account_id: uuid });
  } catch (err) {
    log.warn('[Audit] Failed to disable VPNResellers account', { uuid, error: err.message });
  }

  await db.query(
    `UPDATE vpn_accounts SET status = 'suspended', updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );

  await db.query(
    `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [userId]
  );

  log.info('[Audit] VPN revoked', { uuid, userId, reason });
}

// ─── Core audit ─────────────────────────────────────────────────────────────

/**
 * runOnce() — main entry point. Called every 15 minutes by vpnAuditScheduler.js.
 *
 * For every active/trialing subscription:
 *   1. Verify payment (Plisio completed OR ARB active/suspended/canceled)
 *   2. If payment failed  → revoke VPN
 *   3. If payment success → ensure VPN has ≥ 30 days from last payment anchor
 */
async function runOnce() {
  const { rows: subs } = await db.query(`
    SELECT
      s.id                          AS subscription_id,
      s.user_id,
      s.status                      AS sub_status,
      s.plisio_invoice_id,
      s.arb_subscription_id,
      s.current_period_end,
      s.last_extended_at,
      s.created_at                  AS sub_created_at,
      p.interval                    AS plan_interval,
      p.amount_cents,
      va.id                         AS vpn_account_id,
      va.vpn_uuid,
      va.vpn_username,
      va.expiry_date                AS db_vpn_expiry
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

  log.info('[Audit] Audit run complete');
}

/**
 * auditOne(sub) — audit a single subscription.
 *
 * @param {object} sub — joined row from runOnce()
 */
async function auditOne(sub) {
  const { subscription_id: subId, user_id: userId,
          plan_interval: interval,
          vpn_uuid: vpnUuid, vpn_username: vpnUsername,
          vpn_account_id: vpnAccountId,
          plisio_invoice_id: plisioInvoiceId,
          arb_subscription_id: arbSubId,
          sub_created_at: subCreatedAt,
          last_extended_at: lastExtendedAt } = sub;

  log.info('[Audit] Auditing', { subId, userId, vpnUsername, plisioInvoiceId, arbSubId });

  // ── Step 1: Determine if customer has paid ──────────────────────────────

  // PLISIO path: invoice must be completed
  if (plisioInvoiceId) {
    const paid = await isPlisioPaid(plisioInvoiceId);
    if (!paid) {
      // Invoice not completed yet — customer hasn't paid.
      // If they have a VPN account, revoke it (crypto invoice expired).
      if (vpnUuid) {
        log.info('[Audit] Plisio invoice not completed, revoking VPN', { subId, invoiceId: plisioInvoiceId });
        await revokeVpnAccess(vpnUuid, userId, 'Plisio invoice not completed');
        await db.query(
          `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE id = $1`,
          [subId]
        );
      }
      return;
    }
    // Paid → fall through to access check.
  }

  // ARB path: check subscription status
  if (arbSubId) {
    const arbStatus = await getArbPaymentStatus(arbSubId);

    if (arbStatus === 'canceled' || arbStatus === 'suspended') {
      await revokeVpnAccess(vpnUuid, userId, `ARB ${arbStatus}`);
      await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE id = $1`,
        [subId]
      );
      log.info('[Audit] ARB payment failed, VPN revoked', { subId, arbSubId, arbStatus });
      return;
    }

    if (arbStatus === 'error') {
      // Can't determine ARB status — skip, don't revoke.
      log.info('[Audit] ARB status unknown, skipping', { subId, arbSubId });
      return;
    }

    // ARB is active → paid (or billing date approaching naturally).
    // Fall through to VPN expiry check.
  }

  // No payment method linked — skip (shouldn't happen in practice).
  if (!plisioInvoiceId && !arbSubId) {
    log.info('[Audit] No payment method linked, skipping', { subId });
    return;
  }

  // ── Step 2: VPN access check ───────────────────────────────────────────

  if (!vpnUuid || !vpnAccountId) {
    log.warn('[Audit] No VPN account for active subscription', { subId, userId });
    return;
  }

  // Fetch authoritative VPN expiry from VPNResellers (source of truth).
  let vpnExpiry = null;
  try {
    const acct = await vpnResellersService.getAccount(vpnUuid);
    vpnExpiry = acct?.data?.expire_at || null;
  } catch (err) {
    log.warn('[Audit] Could not fetch VPNResellers expiry, using DB fallback', {
      vpnUuid, error: err.message
    });
    vpnExpiry = sub.db_vpn_expiry
      ? new Date(sub.db_vpn_expiry).toISOString().split('T')[0]
      : null;
  }

  const daysLeft = vpnExpiry ? getDaysUntil(vpnExpiry) : -999;

  // VPN already expired in VPNResellers → revoke locally
  if (daysLeft < 0) {
    await revokeVpnAccess(vpnUuid, userId, `VPN expired (${Math.round(daysLeft)} days ago)`);
    return;
  }

  // ── Step 3: Compute last payment anchor and required expiry ────────────

  // The "last payment anchor" is the date of the last successful payment event.
  // We store this as last_extended_at every time WE extend the account.
  //
  // first extension (no last_extended_at yet):
  //   anchor = the earlier of (sub_created_at, current_period_end - 30 days)
  //   This prevents a newly-created subscription from getting an immediate 30-day
  //   extension just because the billing period happens to be < 30 days away.
  //
  // subsequent extensions (has last_extended_at):
  //   anchor = last_extended_at
  //   We extend to last_extended_at + 30 days, not NOW + 30 days.

  let lastPaymentAnchor;
  if (lastExtendedAt) {
    lastPaymentAnchor = new Date(lastExtendedAt);
  } else {
    // First time extension for this subscription.
    // Use sub_created_at as the payment date (approximation).
    // Or current_period_end - 30 days, whichever is earlier.
    const created = new Date(subCreatedAt);
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
    const thirtyBeforePeriodEnd = periodEnd
      ? new Date(periodEnd.getTime() - 30 * 86400000)
      : created;
    // Anchor = earlier of created and thirtyBeforePeriodEnd
    lastPaymentAnchor = created < thirtyBeforePeriodEnd ? created : thirtyBeforePeriodEnd;
  }

  const requiredExpiry = new Date(lastPaymentAnchor.getTime() + MINIMUM_DAYS * 86400000);
  const requiredExpiryStr = requiredExpiry.toISOString().split('T')[0];

  log.info('[Audit] VPN access check', {
    subId, vpnUuid, vpnExpiry,
    daysLeft: Math.round(daysLeft),
    lastExtendedAt: lastExtendedAt || '(none)',
    lastPaymentAnchor: lastPaymentAnchor.toISOString(),
    requiredExpiry: requiredExpiryStr,
    needsExtension: vpnExpiry < requiredExpiryStr
  });

  // VPN expiry is before the required expiry (i.e., < last payment anchor + 30 days) → extend.
  if (vpnExpiry < requiredExpiryStr) {
    const newExpiry = requiredExpiryStr;
    await extendVpnExpiry(vpnUuid, userId, newExpiry, daysLeft);
    // Also update local DB period_end to match
    await db.query(
      `UPDATE subscriptions SET current_period_end = $1::timestamptz, updated_at = NOW() WHERE id = $2`,
      [newExpiry, subId]
    );
  }
}

module.exports = { runOnce, auditOne };