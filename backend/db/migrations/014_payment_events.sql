-- Migration 014: Payment Events — idempotency + retry queue
-- Tracks every payment lifecycle event with built-in retry support.
-- Background job processes this table every 5 minutes.

CREATE TABLE IF NOT EXISTS payment_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     VARCHAR(255) NOT NULL,          -- Plisio invoice ID, Authorize trans ID, etc.
  payment_method  VARCHAR(50)  NOT NULL,          -- 'plisio' | 'authorize' | 'paymentscloud'
  account_number  VARCHAR(50),                    -- set early if known (else derived from external_id)
  user_id         UUID,
  event_type      VARCHAR(100) NOT NULL,          -- 'payment.pending' | 'payment.completed' | 'provision.vpn' | 'provision.key' | 'provision.email'
  status          VARCHAR(50)  NOT NULL DEFAULT 'pending',  -- 'pending' | 'completed' | 'failed' | 'dead_letter'
  payload         JSONB        DEFAULT '{}',      -- full raw webhook / callback payload
  error_message   TEXT,
  attempts         INTEGER      NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Idempotency: one record per (payment_method, external_id, event_type)
  UNIQUE (payment_method, external_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_status
  ON payment_events (status, last_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_payment_events_account
  ON payment_events (account_number, created_at DESC)
  WHERE account_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_user
  ON payment_events (user_id, event_type, created_at DESC);

COMMENT ON TABLE payment_events IS
'Idempotency + retry queue for all payment-adjacent operations.
Every payment triggers a row; background job processes pending rows.
Rows marked dead_letter require manual intervention.';