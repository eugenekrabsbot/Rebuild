/**
 * External Access Key Service
 *
 * Provides per-customer access keys that active subscribers can use on
 * other sites owned by the company (e.g., ahoyvpn.com).
 *
 * Key rules:
 *   - One active key per customer at a time
 *   - Key exists ONLY while subscription is active
 *   - Manual rotation via admin or automatic expiry
 */
const crypto = require('crypto');
const db = require('../config/database');
const log = require('../utils/logger');

const PREFIX = 'RIPPER2026-'; // prefix for branding/recognition

// ── Generate a new key ──────────────────────────────────────────────────────
function generateKey() {
  const suffix = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `${PREFIX}${suffix}`;
}

// ── Provision a key for a newly-active subscriber ──────────────────────────
async function provisionAccessKey(userId) {
  // Deactivate any existing key first (shouldn't happen normally, but safe)
  await db.query(
    `UPDATE external_access_keys SET is_active = false WHERE user_id = $1`,
    [userId]
  );

  const key = generateKey();
  await db.query(
    `INSERT INTO external_access_keys (user_id, access_key, is_active, created_at, rotated_at)
     VALUES ($1, $2, true, NOW(), NOW())`,
    [userId, key]
  );

  log.info('Access key provisioned', { userId, keyPrefix: key.slice(0, 18) });
  return key;
}

// ── Revoke the active key (sub cancelled / expired) ─────────────────────────
async function revokeAccessKey(userId) {
  const result = await db.query(
    `UPDATE external_access_keys
     SET is_active = false
     WHERE user_id = $1 AND is_active = true
     RETURNING access_key`,
    [userId]
  );
  if (result.rows.length > 0) {
    log.info('Access key revoked', { userId, keyPrefix: result.rows[0].access_key.slice(0, 18) });
  }
}

// ── Get current active key for a user (returns null if none) ────────────────
async function getActiveKey(userId) {
  const result = await db.query(
    `SELECT access_key, rotated_at FROM external_access_keys
     WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
  return result.rows[0] || null;
}

// ── Rotate: generate a new key for an active subscriber ──────────────────────
async function rotateKey(userId) {
  const old = await getActiveKey(userId);
  const newKey = generateKey();

  await db.query(
    `UPDATE external_access_keys SET is_active = false WHERE user_id = $1`,
    [userId]
  );
  await db.query(
    `INSERT INTO external_access_keys (user_id, access_key, is_active, created_at, rotated_at)
     VALUES ($1, $2, true, NOW(), NOW())`,
    [userId, newKey]
  );

  log.info('Access key rotated', { userId, oldPrefix: old?.access_key?.slice(0, 18), newPrefix: newKey.slice(0, 18) });
  return newKey;
}

// ── Verify a key (used by ahoyvpn.com external site) ─────────────────────────
async function verifyKey(accessKey) {
  const result = await db.query(
    `SELECT e.user_id, e.access_key, u.is_active as user_active, s.status as sub_status
     FROM external_access_keys e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN subscriptions s ON s.user_id = e.user_id AND s.status = 'active'
     WHERE e.access_key = $1 AND e.is_active = true`,
    [accessKey]
  );
  if (result.rows.length === 0) return { valid: false, reason: 'Key not found or inactive' };
  const row = result.rows[0];
  if (!row.user_active) return { valid: false, reason: 'Account inactive' };
  if (!row.sub_status) return { valid: false, reason: 'No active subscription' };
  return { valid: true, userId: row.user_id };
}

// ── Expire all keys older than X days (optional automated cleanup) ───────────
async function expireOldKeys(maxAgeDays = 90) {
  const threshold = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  const result = await db.query(
    `UPDATE external_access_keys
     SET is_active = false
     WHERE is_active = true AND rotated_at < $1`,
    [threshold]
  );
  log.info('Expired old access keys', { count: result.rowCount });
  return result.rowCount;
}

module.exports = {
  provisionAccessKey,
  revokeAccessKey,
  getActiveKey,
  rotateKey,
  verifyKey,
  expireOldKeys,
};