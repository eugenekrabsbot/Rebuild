-- Migration: add_authorize_profile_columns_to_subscriptions
-- Adds Authorize.net customer profile IDs to the subscriptions table
-- These are needed for the update-payment flow where customers update their card
-- via Authorize.net's hosted Accept Customer form.

BEGIN;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS customer_profile_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS customer_payment_profile_id VARCHAR(64);

-- Index for fast lookups by profile ID
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_profile_id
  ON subscriptions(customer_profile_id)
  WHERE customer_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_payment_profile_id
  ON subscriptions(customer_payment_profile_id)
  WHERE customer_payment_profile_id IS NOT NULL;

COMMIT;