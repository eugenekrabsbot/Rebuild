const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const webhookController = require('../controllers/webhookController');

// ═══════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS — no authentication required
// ═══════════════════════════════════════════════════════════

// Webhook endpoints
router.post('/webhook/paymentscloud', webhookController.paymentsCloudWebhook);



// Invoice status (public callback from Plisio)
router.get('/invoice/:invoiceId/status', paymentController.getInvoiceStatus);

// ═══════════════════════════════════════════════════════════
// AUTHENTICATED ENDPOINTS — require valid JWT via allowInactive
// ═══════════════════════════════════════════════════════════

const { protect } = require('../middleware/authMiddleware_new');
router.use(protect);

router.get('/plans', paymentController.getPlans);
router.post('/checkout', paymentController.createCheckout);

module.exports = router;