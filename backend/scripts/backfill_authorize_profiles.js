#!/usr/bin/env node
/**
 * backfill_authorize_profiles.js
 *
 * For each subscription with an ARB subscription ID but missing customer_profile_id,
 * query Authorize.net's ARBGetSubscription to get the profile IDs and backfill them.
 *
 * Run: node scripts/backfill_authorize_profiles.js
 * Safe to re-run — skips rows that already have profile IDs.
 */
const { AuthorizeNetService } = require('../src/services/authorizeNetUtils');
const db = require('../src/config/database');

async function main() {
  console.log('Starting Authorize.net profile backfill...');

  // Get all subscriptions with ARB IDs but missing profile IDs
  const result = await db.query(
    `SELECT s.id as subscription_id, s.arb_subscription_id,
            s.user_id, s.status,
            u.email
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.arb_subscription_id IS NOT NULL
       AND (s.customer_profile_id IS NULL OR s.customer_payment_profile_id IS NULL)
     ORDER BY s.created_at ASC`
  );

  console.log(`Found ${result.rows.length} subscriptions needing profile backfill`);

  if (result.rows.length === 0) {
    console.log('Nothing to do — all subscriptions already have profile IDs');
    return;
  }

  const svc = new AuthorizeNetService();
  let updated = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const profileIds = await svc.getArbSubscriptionProfileIds(row.arb_subscription_id);

      if (!profileIds || !profileIds.customerProfileId) {
        console.log(`[SKIP] sub=${row.subscription_id} arb=${row.arb_subscription_id} — no profile returned`);
        failed++;
        continue;
      }

      await db.query(
        `UPDATE subscriptions
         SET customer_profile_id = $1,
             customer_payment_profile_id = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [profileIds.customerProfileId, profileIds.customerPaymentProfileId, row.subscription_id]
      );

      console.log(`[OK] sub=${row.subscription_id} arb=${row.arb_subscription_id} profile=${profileIds.customerProfileId} payment=${profileIds.customerPaymentProfileId}`);
      updated++;
    } catch (err) {
      console.error(`[ERROR] sub=${row.subscription_id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone — ${updated} updated, ${failed} failed`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});