const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { protect, csrfProtection, require2FA, loginRateLimiter, accountLockout } = require('../middleware/authMiddleware_new');

// Public routes (no authentication required)
router.post('/auth/customer/login', loginRateLimiter, accountLockout, customerController.login);
router.post('/auth/customer/register', customerController.register);
router.post('/auth/customer/claim', customerController.claimCredentials);
router.post('/auth/customer/recovery/use-kit', customerController.useRecoveryKit);

// DEBUG: test rotate-kit with no auth — before protect middleware
router.post('/auth/customer/recovery/debug-rotate', async (req, res) => {
  res.json({
    debug: true,
    hasUser: !!req.user,
    userId: req.user?.id,
    cookieKeys: req.cookies ? Object.keys(req.cookies) : [],
    authHeader: req.headers.authorization ? 'present' : 'missing',
    path: req.originalUrl
  });
});

// Protected routes (authentication required)
router.use(protect);
router.use(csrfProtection);

router.post('/auth/customer/logout', customerController.logout);
router.post('/auth/customer/change-password', require2FA, customerController.changePassword);
// rotate-kit: password-protected + 2FA-checked, no CSRF needed
router.post('/auth/customer/recovery/rotate-kit', require2FA, customerController.rotateRecoveryKit);

router.get('/me', customerController.getProfile);
router.get('/me/subscription', customerController.getSubscription);
router.post('/me/subscription/cancel', customerController.cancelSubscription);
router.post('/me/subscription/change-plan', customerController.changePlan);
router.delete('/me', customerController.deleteAccount);
router.get('/me/messages', customerController.getMessages);
router.post('/me/support-ticket', customerController.createSupportTicket);
router.get('/me/update-payment', customerController.updatePaymentRedirect);

module.exports = router;
