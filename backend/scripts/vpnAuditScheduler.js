// vpnAuditScheduler.js - 15-minute cron job runner for vpnAuditService.
// Deploy to: /home/ahoy/BackEnd/backend/scripts/vpnAuditScheduler.js
//
// Add to crontab (crontab -e):
//   */15 * * * * cd /home/ahoy/BackEnd/backend && node scripts/vpnAuditScheduler.js >> /home/ahoy/logs/vpnAudit.log 2>&1
//
// Each run is self-contained. The audit service queries all subscription + VPN state fresh each time.

'use strict';

const log = require('../src/utils/logger');

async function main() {
  const start = Date.now();
  log.info('[Audit] Starting 15-minute audit run');

  try {
    const { runOnce } = require('../src/services/vpnAuditService');
    await runOnce();
    const elapsed = Math.round((Date.now() - start) / 1000);
    log.info('[Audit] Audit run complete', { elapsedSecs: elapsed });
  } catch (err) {
    log.error('[Audit] Fatal run error', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});