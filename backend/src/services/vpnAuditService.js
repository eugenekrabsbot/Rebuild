/**
 * vpnAuditService.js — Payment → Access Audit
 * ===========================================
 *
 * Runs every 15 minutes. Each active subscription is checked against the rule:
 *
 *   "If a customer has paid and their VPN expires within the plan interval
 *    (30/90/180/365 days), they get exactly that many days from the payment date.
 *    No more. No less."
 *
 * ACCESS CHECK:
 *   extend if  vpnExpireAt < today + intervalDays
 *   (VPNResellers expiry is the source of truth)
 *
 * ANCHOR — last_extended_at:
 *   This column stores the date of the last PAYMENT EVENT.
 *   - On first extension: payment_date = vpnExpireAt - intervalDays
 *   - On subsequent charges: payment_date = vpnExpireAt - intervalDays (derived from VPNResellers jump)
 *   - Plisio: payment_date = invoice completion date (Unix timestamp in API)
 *
 *   Once set, last_extended_at ensures we never extend again for the same payment.
 *   The next charge updates it when it fires and VPNResellers jumps ahead.
 *
 * REVOCATION:
 *   - Plisio invoice not 'completed' → revoke VPN
 *   - ARB status suspended/canceled → revoke VPN immediately
 *   - VPNResellers expire_at in the past → revoke locally
 *
 * PLAN INTERVALS:
 *   month: 30 days | quarter: 90 | semi_annual: 180 | year: 365
 *
 * CRON: every-15-min cron via: cd /home/ahoy/BackEnd && node backend/scripts/vpnAuditScheduler.js
 */

'use strict';

const db = require('../config/database');
const VpnResellersService = require('./vpnResellersService');
const { AuthorizeNetService } = require('./authorizeNetUtils');
const log = require('../utils/logger');

const vpnResellersService = new VpnResellersService();
const authorizeService = new AuthorizeNetService();

const PLAN_DAYS = { month: 30, quarter: 90, semi_annual: 180, year: 365 };

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** YYYY-MM-DD `days` days from dateStr (default: today). */
function daysFrom(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** Days between dateStr and today (negative = past). Infinity = null. */
function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ─── Payment verification ─────────────────────────────────────────────────────

/**
 * isPlisioCompleted(invoiceId)
 * Returns true only for 'completed' (customer paid) invoices.
 * All other Plisio statuses (pending, expired, cancelled, etc.) = no access.
 */
async function isPlisioCompleted(invoiceId) {
  if (!invoiceId) return false;
  try {
    const resp = await fetch(
      `https://api.plisio.net/api/v1/invoices/${invoiceId}?api_key=${process.env.PLISIO_API_KEY}`
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.data?.status === 'completed';
  } catch (err) {
    log.warn('[Audit] Plisio check failed', { invoiceId, error: err.message });
    return false;
  }
}

/**
 * getPlisioCompletedDate(invoiceId)
 * Returns YYYY-MM-DD of when the invoice was confirmed paid, or null.
 * Plisio's API returns created_utc as a Unix timestamp.
 */
async function getPlisioCompletedDate(invoiceId) {
  try {
    const resp = await fetch(
      `https://api.plisio.net/api/v1/invoices/${invoiceId}?api_key=${process.env.PLISIO_API_KEY}`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const ts = data?.data?.created_utc;
    if (!ts) return null;
    return new Date(Number(ts) * 1000).toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * getArbStatus(arbSubscriptionId)
 * Returns { status, startDate, amount } or null on error.
 * startDate is the ARB billing date for this period.
 */
async function getArbStatus(arbSubscriptionId) {
  if (!arbSubscriptionId) return null;
  try {
    // getArbSubscription already works and returns { status, ... }
    const arb = await authorizeService.getArbSubscription(String(arbSubscriptionId));
    if (!arb || arb.status === 'unknown') return null;

    // Fetch raw to get startDate
    const raw = await authorizeService._makeRequest({
      ARBGetSubscriptionRequest: {
        merchantAuthentication: {
          name: process.env.AUTHORIZE_NET_API_LOGIN_ID,
          transactionKey: process.env.AUTHORIZE_NET_TRANSACTION_KEY
        },
        subscriptionId: String(arbSubscriptionId)
      }
    });

    const sub = raw?.subscription;
    if (!sub) return null;

    return {
      status: String(sub.status || 'unknown').toLowerCase(),
      startDate: sub.paymentSchedule?.startDate?.split('T')[0] || null,
      amount: parseFloat(sub.amount) || 0,
    };
  } catch (err) {
    log.warn('[Audit] ARB lookup failed', { arbSubscriptionId, error: err.message });
    return null;
  }
}

// ─── VPN operations ───────────────────────────────────────────────────────────

/**
 * extendVpn(uuid, userId, newExpiry, daysLeft, paymentDate)
 *
 * Sets VPNResellers expire_at to newExpiry.
 * Updates local DB: vpn_accounts.expiry_date, subscriptions.current_period_end
 * Sets subscriptions.last_extended_at = paymentDate (the anchor for this payment).
 */
async function extendVpn(uuid, userId, newExpiry, daysLeft, paymentDate) {
  if (!uuid) return;
  try {
    await vpnResellersService.setExpiry(uuid, newExpiry);
  } catch (err) {
    log.error('[Audit] setExpiry failed', { uuid, newExpiry, error: err.message });
  }

  await db.query(
    `UPDATE vpn_accounts SET expiry_date = $1::date, updated_at = NOW() WHERE vpn_uuid = $2`,
    [newExpiry, uuid]
  );

  await db.query(
    `UPDATE subscriptions
        SET current_period_end  = $1::timestamptz,
            last_extended_at    = $2::timestamptz,
            updated_at          = NOW()
        WHERE user_id = $3 AND status IN ('active','trialing')`,
    [newExpiry, paymentDate, userId]
  );

  log.info('[Audit] VPN extended', { uuid, userId, newExpiry, daysLeft: Math.round(daysLeft), paymentDate });
}

/**
 * revokeVpn(uuid, userId, reason)
 */
async function revokeVpn(uuid, userId, reason) {
  if (!uuid) return;
  try {
    await vpnResellersService.disableAccount({ account_id: uuid });
  } catch (err) {
    log.warn('[Audit] deactivateAccount failed', { uuid, error: err.message });
  }

  await db.query(
    `UPDATE vpn_accounts SET status = 'disabled', updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
  await db.query(
    `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
  await db.query(
    `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );

  log.info('[Audit] VPN revoked', { uuid, userId, reason });
}

// ─── Core ─────────────────────────────────────────────────────────────────────

async function runOnce() {
  const { rows: subs } = await db.query(`
    SELECT
      s.id                          AS subscription_id,
      s.user_id,
      s.plisio_invoice_id,
      s.arb_subscription_id,
      s.current_period_end,
      s.last_extended_at,
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
    LIMIT 200
  `);

  log.info('[Audit] Starting', { count: subs.length });

  for (const sub of subs) {
    try {
      await auditOne(sub);
    } catch (err) {
      log.error('[Audit] Error', { subId: sub.subscription_id, error: err.message });
    }
  }

  log.info('[Audit] Complete');
}

/**
 * auditOne(sub)
 *
 * For each active/trialing subscription:
 *
 *   PLISIO:
 *     - Invoice not completed → revoke VPN
 *     - Invoice completed → paymentDate = invoice completion date
 *       → extend if vpnExpireAt < paymentDate + intervalDays
 *       → set last_extended_at = paymentDate
 *
 *   ARB:
 *     - Status suspended/canceled → revoke VPN
 *     - Status active:
 *       → if no last_extended_at yet → skip (waiting for first ARB charge)
 *       → if last_extended_at set:
 *         paymentDate = last_extended_at
 *         extend if vpnExpireAt < paymentDate + intervalDays
 *       → detect new charge: vpnExpireAt jumped significantly ahead of db period_end
 *         (aheadByDays >= intervalDays - 2 means a charge fired)
 *         → set last_extended_at = vpnExpireAt - intervalDays (new payment anchor)
 */
async function auditOne(sub) {
  const { subscription_id: subId, user_id: userId,
          plan_interval: interval,
          vpn_uuid: vpnUuid, vpn_username: vpnUsername,
          vpn_account_id: vpnAccountId,
          plisio_invoice_id: plisioInvoiceId,
          arb_subscription_id: arbSubId,
          current_period_end: dbPeriodEnd,
          last_extended_at: lastExtendedAt } = sub;

  const intervalDays = PLAN_DAYS[interval] || 30;
  const hasVpn = Boolean(vpnUuid && vpnAccountId);

  // ── Fetch authoritative VPN expiry from VPNResellers ──────────────────────
  let vpnExpireAt = null;
  if (vpnUuid) {
    try {
      const acct = await vpnResellersService.getAccount(vpnUuid);
      vpnExpireAt = acct?.data?.expire_at || null;
    } catch (err) {
      log.warn('[Audit] VPNResellers unreachable', { vpnUuid, error: err.message });
    }
  }

  const daysLeft = vpnExpireAt ? daysUntil(vpnExpireAt) : -999;

  // ── REVOKE: VPN already expired in VPNResellers ──────────────────────────
  if (hasVpn && daysLeft < 0) {
    await revokeVpn(vpnUuid, userId, `Expired ${Math.abs(Math.round(daysLeft))} days ago`);
    return;
  }

  // ── PLISIO ───────────────────────────────────────────────────────────────
  if (plisioInvoiceId) {
    const paid = await isPlisioCompleted(plisioInvoiceId);

    if (!paid) {
      // Invoice not completed (expired/cancelled/pending) → revoke
      if (hasVpn) {
        log.info('[Audit] Plisio not completed, revoking', { subId, invoiceId: plisioInvoiceId });
        await revokeVpn(vpnUuid, userId, 'Plisio invoice not completed');
        await db.query(`UPDATE subscriptions SET status='canceled', updated_at=NOW() WHERE id=$1`, [subId]);
      }
      return;
    }

    // Paid: the invoice completion date is the payment anchor.
    const paymentDate = await getPlisioCompletedDate(plisioInvoiceId) || daysFrom(null, 0);
    const requiredExpiry = daysFrom(paymentDate, intervalDays);

    log.info('[Audit] Plisio paid', {
      subId, invoiceId: plisioInvoiceId,
      paymentDate, requiredExpiry, vpnExpireAt,
      daysLeft: Math.round(daysLeft),
      intervalDays
    });

    if (hasVpn && vpnExpireAt && vpnExpireAt < requiredExpiry) {
      // VPN has less than what they paid for → extend to exact paid-through date
      await extendVpn(vpnUuid, userId, requiredExpiry, daysLeft, paymentDate);
    }
    return;
  }

  // ── ARB ─────────────────────────────────────────────────────────────────
  if (arbSubId) {
    const arb = await getArbStatus(arbSubId);

    if (!arb) {
      log.info('[Audit] ARB status unknown, skipping', { subId, arbSubId });
      return;
    }

    if (arb.status === 'suspended' || arb.status === 'canceled') {
      await revokeVpn(vpnUuid, userId, `ARB ${arb.status}`);
      await db.query(`UPDATE subscriptions SET status='canceled', updated_at=NOW() WHERE id=$1`, [subId]);
      log.info('[Audit] ARB suspended/canceled, revoked', { subId, arbSubId, status: arb.status });
      return;
    }

    // ARB is active — VPNResellers is updated by THEIR Authorize.net webhook on each charge.
    // If vpnExpireAt is significantly ahead of our db period_end, a charge just fired.

    if (!hasVpn) {
      log.info('[Audit] ARB active, no VPN account yet', { subId, arbSubId });
      return;
    }

    // No VPNResellers expiry at all — use DB as fallback
    if (!vpnExpireAt) {
      const dbExpiry = dbPeriodEnd ? new Date(dbPeriodEnd).toISOString().split('T')[0] : null;
      if (dbExpiry && dbExpiry <= daysFrom(null, intervalDays)) {
        await extendVpn(vpnUuid, userId, daysFrom(null, intervalDays), daysLeft, daysFrom(null, 0));
      }
      return;
    }

    // ── Detect if a new ARB charge has fired ────────────────────────────────
    // If VPNResellers jumped ahead by ~intervalDays, it means their webhook
    // received the charge and updated the account ahead of our DB.
    // We record this as a new payment event.
    const dbExp = dbPeriodEnd ? new Date(dbPeriodEnd) : null;
    const vpnExp = new Date(vpnExpireAt);
    const aheadByDays = dbExp
      ? Math.round((vpnExp.getTime() - dbExp.getTime()) / 86400000)
      : -999;

    if (aheadByDays >= intervalDays - 2) {
      // New charge detected: sync DB to VPNResellers and update payment anchor
      const newPaymentDate = daysFrom(vpnExpireAt, -intervalDays); // vpnExpireAt - interval = charge date

      await db.query(
        `UPDATE subscriptions
            SET current_period_end = $1::timestamptz,
                last_extended_at    = $2::timestamptz,
                updated_at          = NOW()
            WHERE id = $3`,
        [vpnExpireAt, newPaymentDate, subId]
      );

      await db.query(
        `UPDATE vpn_accounts SET expiry_date = $1::date, updated_at = NOW() WHERE vpn_uuid = $2`,
        [vpnExpireAt, vpnUuid]
      );

      log.info('[Audit] ARB charge detected, synced', {
        subId, arbSubId, vpnExpireAt,
        newPaymentDate, aheadByDays, intervalDays
      });
      return; // VPNResellers is already at the correct new expiry
    }

    // ── Check access: does VPN have at least intervalDays from last payment? ──
    // ARB is active but has no payment anchor yet.
    // Customer has whatever access VPNResellers granted — we watch for the first
    // charge to fire (aheadByDays detection above) or flag it if it should have happened.
    if (!lastExtendedAt) {
      log.warn('[Audit] ARB active, no payment anchor (last_extended_at=null) — awaiting first charge detection', {
        subId, arbSubId, vpnExpireAt, daysLeft: Math.round(daysLeft), intervalDays
      });
      return;
    }

    const paymentDate = new Date(lastExtendedAt).toISOString().split('T')[0];
    const requiredExpiry = daysFrom(paymentDate, intervalDays);

    log.info('[Audit] ARB access check', {
      subId, arbSubId,
      paymentDate, requiredExpiry,
      vpnExpireAt, daysLeft: Math.round(daysLeft),
      intervalDays
    });

    if (vpnExpireAt < requiredExpiry) {
      // VPNResellers is stale (webhook miss). Extend to match what was paid.
      const extendTo = requiredExpiry;
      await extendVpn(vpnUuid, userId, extendTo, daysLeft, paymentDate);
      await db.query(
        `UPDATE subscriptions SET current_period_end = $1::timestamptz, updated_at = NOW() WHERE id = $2`,
        [extendTo, subId]
      );
    }
    // else: VPN has the correct time → all good
    return;
  }

  log.warn('[Audit] Active subscription with no payment method', { subId });
}

module.exports = { runOnce, auditOne };