-- Backfill customer_profile_id and customer_payment_profile_id
-- for existing ARB subscriptions that were created before this field existed.
-- Run: PGPASSWORD=ahoyvpn_secure_password psql -h localhost -U ahoyvpn -d ahoyvpn -f /home/ahoy/BackEnd/backend/scripts/backfill_arb_profiles.sql

-- ARB 72782012 → customerProfileId 1370341372, paymentProfileId 821542928
UPDATE subscriptions
SET customer_profile_id = '1370341372',
    customer_payment_profile_id = '821542928',
    updated_at = NOW()
WHERE arb_subscription_id = '72782012'
  AND (customer_profile_id IS NULL OR customer_profile_id = '');

-- ARB 72782027 → customerProfileId 1370341887, paymentProfileId 821543484
UPDATE subscriptions
SET customer_profile_id = '1370341887',
    customer_payment_profile_id = '821543484',
    updated_at = NOW()
WHERE arb_subscription_id = '72782027'
  AND (customer_profile_id IS NULL OR customer_profile_id = '');

-- Verify
SELECT id, arb_subscription_id, customer_profile_id, customer_payment_profile_id, status
FROM subscriptions
WHERE arb_subscription_id IN ('72782012', '72782027');