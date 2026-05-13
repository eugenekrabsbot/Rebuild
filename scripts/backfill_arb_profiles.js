// Backfill customer_profile_id and customer_payment_profile_id for existing ARB subscriptions
// that were created before this field was tracked.
// Run once: node backend/scripts/backfill_arb_profiles.js

const { AuthorizeNetService } = require('../src/services/authorizeNetUtils');
const db = require('../src/config/database');

async function main() {
  const svc = new AuthorizeNetService();

  // Find all active/trial ARB subs missing profile data
  const result = await db.query(
    `SELECT s.id, s.arb_subscription_id, s.status
     FROM subscriptions s
     WHERE s.arb_subscription_id IS NOT NULL
       AND s.status IN ('active', 'trialing')
       AND (s.customer_profile_id IS NULL OR s.customer_profile_id = '')
     ORDER BY s.created_at DESC`
  );

  console.log(`Found ${result.rows.length} subscriptions missing profile IDs`);

  for (const row of result.rows) {
    console.log(`\nProcessing ARB ${row.arb_subscription_id} (${row.id})...`);
    const ids = await svc.getArbSubscriptionProfileIds(row.arb_subscription_id);
    if (!ids) {
      console.log(`  ERROR: Could not fetch profile IDs from Authorize.net`);
      continue;
    }

    console.log(`  customerProfileId: ${ids.customerProfileId}`);
    console.log(`  customerPaymentProfileId: ${ids.customerPaymentProfileId}`);

    await db.query(
      `UPDATE subscriptions
       SET customer_profile_id = $1,
           customer_payment_profile_id = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [ids.customerProfileId, ids.customerPaymentProfileId, row.id]
    );
    console.log(`  ✓ Updated`);
  }

  console.log('\nDone!');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});