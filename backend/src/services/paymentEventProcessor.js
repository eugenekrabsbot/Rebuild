/**
 * paymentEventProcessor — Background cron job (runs every 5 minutes).
 *
 * Processes all 'pending' and 'failed' rows from payment_events.
 * Each row is a discrete operation (VPN creation, key provisioning, email, ARB setup).
 *
 * The processor is idempotent by design:
 *   - It calls paymentEventService.recordEvent() at entry points (webhook/relay).
 *   - If the operation already completed, recordEvent returns { skipped: 'already_completed' }.
 *   - If it's still pending, the processor skips it.
 *   - If it's failed, the attempt counter is incremented and it retries.
 *
 * Failed operations are retried up to MAX_ATTEMPTS (10) times.
 * After MAX_ATTEMPTS, they go to 'dead_letter' status — requiring manual intervention.
 *
 * Ops handled:
 *   provision.vpn   → createVpnAccount
 *   provision.key   → provisionAccessKey
 *   provision.email → sendAccountCreatedEmail
 *   provision.arb   → createArbSubscriptionFromProfile
 */
const paymentEventService = require('./paymentEventService');
const vpnResellersService = require('./vpnResellersService');
const { provisionAccessKey } = require('./accessKeyService');
const emailService = require('./emailService');
const { getAuthorizeTransactionDetails } = require('./authorizeNetUtils');
const AuthorizeNetService = require('./authorizeNetUtils').AuthorizeNetService;
const db = require('../config/database');
const log = require('../utils/logger');

const { markCompleted, markFailed, markDeadLetter } = paymentEventService;

let isRunning = false;
let processorInterval = null;

// ── Per-operation handlers ────────────────────────────────────────────────────

async function handleProvisionVpn(event) {
  const { payload, account_number: accountNumber } = event;
  const userId = payload.user_id || event.user_id;
  const planInterval = payload.plan_interval || 'month';

  if (!userId) {
    throw new Error('provision.vpn: user_id missing for ' + event.external_id);
  }

  // createVpnAccount handles DB write + expiry, and is idempotent via ON CONFLICT
  const { createVpnAccount } = require('./userService');
  const result = await createVpnAccount(userId, accountNumber, planInterval);
  return result;
}

async function handleProvisionKey(event) {
  const userId = event.payload?.user_id || event.user_id;
  if (!userId) throw new Error('provision.key: user_id missing for ' + event.external_id);
  await provisionAccessKey(userId);
  return { provisioned: true };
}

async function handleProvisionEmail(event) {
  const { payload } = event;
  const email = payload.email;
  const vpnUsername = payload.vpn_username;
  const vpnPassword = payload.vpn_password;
  const expiryDate = payload.expiry_date;

  if (!email || !vpnUsername || !vpnPassword) {
    throw new Error('provision.email: missing required fields for ' + event.external_id);
  }
  await emailService.sendAccountCreatedEmail(email, vpnUsername, vpnPassword, expiryDate);
  return { sent: true };
}

async function handleProvisionArb(event) {
  const { payload, external_id: externalId } = event;
  const txDetails = payload.transactionDetails;

  if (!txDetails?.customerProfileId || !txDetails?.customerPaymentProfileId) {
    throw new Error('provision.arb: missing customerProfileId or customerPaymentProfileId for ' + externalId);
  }

  const arbIntervals = new Set(['month', 'quarter']);
  if (!arbIntervals.has(payload.plan_interval)) {
    return { skipped: 'non-recurring plan' };
  }

  const intervalLength = payload.plan_interval === 'quarter' ? 3 : 1;
  const periodEnd = new Date(payload.current_period_end);
  const arbStartDate = new Date(periodEnd);
  arbStartDate.setDate(arbStartDate.getDate() + 1);
  const arbStartStr = arbStartDate.toISOString().split('T')[0];

  const arbAmount = ((payload.amount_cents || 599) / 100).toFixed(2);

  const arbResult = await AuthorizeNetService.createArbSubscriptionFromProfile({
    amount: arbAmount,
    intervalLength,
    intervalUnit: 'months',
    startDate: arbStartStr,
    customerProfileId: txDetails.customerProfileId,
    customerPaymentProfileId: txDetails.customerPaymentProfileId,
    subscriberEmail: payload.email || '',
    description: 'AhoyVPN ' + (payload.plan_interval === 'quarter' ? 'Quarterly' : 'Monthly') + ' Plan',
    invoiceNumber: externalId,
  });

  if (arbResult?.subscriptionId && payload.subscription_id) {
    await db.query(
      'UPDATE subscriptions SET arb_subscription_id = $1, updated_at = NOW() WHERE id = $2',
      [arbResult.subscriptionId, payload.subscription_id]
    );
  }

  return { arbSubscriptionId: arbResult?.subscriptionId };
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

async function processEvent(event) {
  const { event_type: eventType, external_id: externalId, payment_method: paymentMethod } = event;

  try {
    let result;
    switch (eventType) {
      case 'provision.vpn':
        result = await handleProvisionVpn(event);
        break;
      case 'provision.key':
        result = await handleProvisionKey(event);
        break;
      case 'provision.email':
        result = await handleProvisionEmail(event);
        break;
      case 'provision.arb':
        result = await handleProvisionArb(event);
        break;
      default:
        log.warn('[paymentEventProcessor] Unknown event_type', { eventType, externalId });
        await markDeadLetter(externalId, paymentMethod, eventType, 'Unknown event_type: ' + eventType);
        return { handled: false, reason: 'unknown_event_type' };
    }

    await markCompleted(externalId, paymentMethod, eventType);
    log.info('[paymentEventProcessor] Completed', { eventType, externalId, result });
    return { handled: true, result };
  } catch (err) {
    log.error('[paymentEventProcessor] Operation failed', {
      eventType, externalId, paymentMethod,
      attempt: event.attempts + 1,
      error: err.message,
    });

    const nextStatus = (event.attempts + 1) >= paymentEventService.MAX_ATTEMPTS ? 'dead_letter' : 'failed';
    if (nextStatus === 'dead_letter') {
      await markDeadLetter(externalId, paymentMethod, eventType, err.message);
    } else {
      await markFailed(externalId, paymentMethod, eventType, err.message);
    }
    return { handled: false, error: err.message };
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

module.exports = {
  start: () => {
    processorInterval = setInterval(async () => {
      if (isRunning) {
        log.info('[paymentEventProcessor] Previous run still in progress, skipping');
        return;
      }
      isRunning = true;
      log.info('[paymentEventProcessor] Run starting');
      try {
        const events = await paymentEventService.fetchRetryable(50);
        log.info('[paymentEventProcessor] Found ' + events.length + ' events to process');
        for (const event of events) {
          await processEvent(event);
        }
      } catch (err) {
        log.error('[paymentEventProcessor] Run failed', { error: err.message });
      } finally {
        isRunning = false;
        log.info('[paymentEventProcessor] Run complete');
      }
    }, 5 * 60 * 1000);
    log.info('[paymentEventProcessor] Started — running every 5 minutes');
  },
  stop: () => {
    if (processorInterval) {
      clearInterval(processorInterval);
      processorInterval = null;
    }
    log.info('[paymentEventProcessor] Stopped');
  },
};