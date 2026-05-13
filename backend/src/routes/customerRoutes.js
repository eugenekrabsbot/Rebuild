const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { protect, csrfProtection, require2FA, loginRateLimiter, accountLockout } = require('../middleware/authMiddleware_new');

// Public routes (no authentication required)
router.post('/auth/customer/login', loginRateLimiter, accountLockout, customerController.login);
router.post('/auth/customer/register', customerController.register);
router.post('/auth/customer/claim', customerController.claimCredentials);
router.post('/auth/customer/recovery/use-kit', customerController.useRecoveryKit);

// Protected routes (authentication required)
router.use(protect);
router.use(csrfProtection);

router.post('/auth/customer/logout', customerController.logout);
router.post('/auth/customer/change-password', require2FA, customerController.changePassword);
router.post('/auth/customer/recovery/rotate-kit', require2FA, customerController.rotateRecoveryKit);

router.get('/me', customerController.getProfile);
router.get('/me/subscription', customerController.getSubscription);
router.post('/me/subscription/cancel', customerController.cancelSubscription);
router.get('/me/subscription/change-plan', customerController.changePlan);
router.get('/me/update-payment', customerController.updatePaymentRedirect);
router.delete('/me', customerController.deleteAccount);
router.get('/me/messages', customerController.getMessages);
router.post('/me/support-ticket', customerController.createSupportTicket);

module.exports = router;
