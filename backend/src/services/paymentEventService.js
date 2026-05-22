/**
 * paymentEventService — Idempotency + retry queue for payment-adjacent operations.
 *
 * ARCHITECTURE:
 * Every payment trigger (webhook, relay) records ONE row per distinct operation.
 * If the same (payment_method, external_id, event_type) already exists:
 *   - pending → skip (idempotent, still in flight)
 *   - completed → skip (idempotent, already done)
 *   - failed → increment attempt counter, process again
 *
 * The background job (paymentEventProcessor) runs every 5 minutes and processes
 * all 'pending' and 'failed' rows up to MAX_ATTEMPTS times.
 *
 * event_type enum:
 *   payment.completed  — payment confirmed (webhook/relay entry point)
 *   provision.vpn     — VPN account creation
 *   provision.key      — AhoyRipper access key provisioning
 *   provision.email    — welcome email sent
 *   provision.arb      — ARB subscription created (authorize.net only)
 */
const db = require('../config/database');
const log = require('../utils/logger');

const MAX_ATTEMPTS = 10;
const DEAD_LETTER_AFTER = 7; // days before marking dead_letter

// ── Record an event (idempotent upsert) ──────────────────────────────────────

/**
 * Record or update a payment event.
 * Pass existing row values via `onConflictUpdate` for partial updates.
 *
 * @param {string} externalId   - Plisio invoice, authorize trans id, etc.
 * @param {string} paymentMethod - 'plisio' | 'authorize' | 'paymentscloud'
 * @param {string} eventType   - e.g. 'payment.completed', 'provision.vpn'
 * @param {object} payload     - raw webhook / relay payload to store
 * @param {object} extras     - { accountNumber, userId, status, errorMessage }
 * @returns {object}            - { isNew: bool, event: row }
 */
async function recordEvent(externalId, paymentMethod, eventType, payload = {}, extras = {}) {
  const { accountNumber = null, userId = null, status = 'pending', errorMessage = null } = extras;
  const now = new Date().toISOString();

  // Try INSERT first — most calls will be new
  try {
    const insertResult = await db.query(
      `INSERT INTO payment_events
         (external_id, payment_method, event_type, payload, account_number, user_id, status, error_message, attempts, last_attempt_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $9)
       ON CONFLICT (payment_method, external_id, event_type) DO NOTHING
       RETURNING *`,
      [externalId, paymentMethod, eventType, JSON.stringify(payload), accountNumber, userId, status, errorMessage, now]
    );
    if (insertResult.rows.length > 0) {
      return { isNew: true, event: insertResult.rows[0] };
    }
  } catch (err) {
    log.error('[paymentEventService] recordEvent insert failed', { externalId, paymentMethod, eventType, error: err.message });
  }

  // Conflict — fetch existing row
  const existing = await db.query(
    `SELECT * FROM payment_events
      WHERE payment_method = $1 AND external_id = $2 AND event_type = $3`,
    [paymentMethod, externalId, eventType]
  );

  if (existing.rows.length === 0) {
    return { isNew: false, event: null };
  }

  const row = existing.rows[0];

  // Already completed — skip (idempotent)
  if (row.status === 'completed') {
    return { isNew: false, event: row, skipped: 'already_completed' };
  }

  // Pending — still being processed by another worker, skip
  if (row.status === 'pending') {
    return { isNew: false, event: row, skipped: 'still_pending' };
  }

  // Failed — increment attempt counter, re-queue for retry
  const updated = await db.query(
    `UPDATE payment_events
        SET status = 'pending',
            attempts = attempts + 1,
            last_attempt_at = $1,
            error_message = COALESCE($2, error_message)
      WHERE id = $3
      RETURNING *`,
    [now, errorMessage, row.id]
  );

  return { isNew: false, event: updated.rows[0], retried: true };
}

// ── Mark event completed ───────────────────────────────────────────────────────

async function markCompleted(externalId, paymentMethod, eventType) {
  await db.query(
    `UPDATE payment_events
        SET status = 'completed', completed_at = NOW(), last_attempt_at = NOW()
      WHERE payment_method = $1 AND external_id = $2 AND event_type = $3`,
    [paymentMethod, externalId, eventType]
  );
}

// ── Mark event failed ─────────────────────────────────────────────────────────

async function markFailed(externalId, paymentMethod, eventType, errorMessage) {
  await db.query(
    `UPDATE payment_events
        SET status = 'failed', error_message = $1, last_attempt_at = NOW()
      WHERE payment_method = $2 AND external_id = $3 AND event_type = $4`,
    [errorMessage, paymentMethod, externalId, eventType]
  );
}

// ── Mark dead letter ─────────────────────────────────────────────────────────

async function markDeadLetter(externalId, paymentMethod, eventType, errorMessage) {
  await db.query(
    `UPDATE payment_events
        SET status = 'dead_letter', error_message = $1, last_attempt_at = NOW()
      WHERE payment_method = $2 AND external_id = $3 AND event_type = $4`,
    [errorMessage, paymentMethod, externalId, eventType]
  );
}

// ── Fetch pending + retryable events ─────────────────────────────────────────

async function fetchRetryable(limit = 50) {
  const result = await db.query(
    `SELECT * FROM payment_events
      WHERE status IN ('pending', 'failed')
        AND attempts < $1
        AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '5 minutes')
      ORDER BY created_at ASC
      LIMIT $2`,
    [MAX_ATTEMPTS, limit]
  );
  return result.rows;
}

// ── Get events for an account ─────────────────────────────────────────────────

async function getEventsForAccount(accountNumber) {
  const result = await db.query(
    `SELECT * FROM payment_events
      WHERE account_number = $1
      ORDER BY created_at DESC`,
    [accountNumber]
  );
  return result.rows;
}

// ── Get all dead-letter events (for admin) ────────────────────────────────────

async function getDeadLetters() {
  const result = await db.query(
    `SELECT * FROM payment_events
      WHERE status = 'dead_letter'
      ORDER BY created_at DESC
      LIMIT 100`
  );
  return result.rows;
}

// ── Manually retry a dead event ──────────────────────────────────────────────

async function retryEvent(id) {
  const result = await db.query(
    `UPDATE payment_events
        SET status = 'pending', attempts = 0, error_message = NULL, last_attempt_at = NULL
      WHERE id = $1
      RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

module.exports = {
  recordEvent,
  markCompleted,
  markFailed,
  markDeadLetter,
  fetchRetryable,
  getEventsForAccount,
  getDeadLetters,
  retryEvent,
  MAX_ATTEMPTS,
};