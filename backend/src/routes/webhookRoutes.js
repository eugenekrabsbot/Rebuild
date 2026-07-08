const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Webhook endpoints (public, no authentication required)
// NOTE: Plisio may send callbacks as GET (with query params) or POST (with JSON body)
router.post('/webhooks/plisio', webhookController.plisioWebhook);
router.get('/webhooks/plisio', webhookController.plisioWebhook);

router.post('/webhooks/paymentscloud', webhookController.paymentsCloudWebhook);

// Backward-compatible aliases
router.post('/payment/webhook/plisio', webhookController.plisioWebhook);
router.get('/payment/webhook/plisio', webhookController.plisioWebhook);

router.post('/payment/webhook/paymentscloud', webhookController.paymentsCloudWebhook);

module.exports = router;
