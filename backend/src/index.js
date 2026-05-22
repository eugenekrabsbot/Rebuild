require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');

const log = require('./utils/logger');

const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { protect, csrfProtection } = require('./middleware/authMiddleware_new');
const { cspConfig, ScriptIntegrityMonitor, paymentSecurityMiddleware, handleCSPReport } = require('./middleware/securityMiddleware');
const authRoutes = require('./routes/authRoutes');
const authRoutesCsrf = require('./routes/authRoutes_csrf');
const userRoutes = require('./routes/userRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const vpnRoutes = require('./routes/vpnRoutes');
const customerRoutes = require('./routes/customerRoutes');
const affiliateRoutes = require('./routes/affiliateRoutes');
const adminRoutes = require('./routes/adminRoutes');
const affiliateAuthRoutes = require('./routes/affiliateAuthRoutes');
const affiliateDashboardRoutes = require('./routes/affiliateDashboardRoutes');
const ahoymanRoutes = require('./routes/ahoymanRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const refRoute = require('./routes/refRoute');
const supportRoutes = require('./routes/supportRoutes');
const pageController = require('./controllers/pageController');

const app = express();
const PORT = process.env.PORT || 3000;

// Honor proxy headers (Cloudflare) so rate limiting and IPs work correctly
app.set('trust proxy', 1);

// Initialize script integrity monitor
const scriptMonitor = new ScriptIntegrityMonitor();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(helmet.contentSecurityPolicy(cspConfig));
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS ? parseInt(process.env.RATE_LIMIT_WINDOW_MS) : 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) : 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

// Stricter rate limiting for sensitive endpoints
const sensitiveLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50,
  message: { error: 'Too many attempts. Please try again later.' },
});
app.use('/api/auth/login', sensitiveLimiter);
app.use('/api/auth/register', sensitiveLimiter);
app.use('/api/payment/checkout', sensitiveLimiter);

// Body parsing (capture rawBody for webhook signature verification)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Apply payment security middleware
app.use(paymentSecurityMiddleware);

// Apply script monitoring middleware
app.use(scriptMonitor.middleware());

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// CSP report endpoint
app.post('/api/security/csp-report', handleCSPReport);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    security: {
      csp: 'enabled',
      scriptMonitoring: scriptMonitor.monitoringEnabled
    }
  });
});

// Security headers test endpoint
app.get('/api/security/headers', (req, res) => {
  res.json({
    csp: res.getHeader('Content-Security-Policy'),
    xFrameOptions: res.getHeader('X-Frame-Options'),
    xContentTypeOptions: res.getHeader('X-Content-Type-Options'),
    xXSSProtection: res.getHeader('X-XSS-Protection'),
    referrerPolicy: res.getHeader('Referrer-Policy')
  });
});

// Public auth routes (no blanket auth) — must come BEFORE customerRoutes which applies global protect
app.use('/api/auth/affiliate', affiliateAuthRoutes);
app.use('/api/auth/ahoyman', ahoymanRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', authRoutesCsrf);
app.use('/api/user', userRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/vpn', vpnRoutes);
// Keep public webhook routes before routers that add blanket auth middleware
app.use('/api', webhookRoutes);
app.use('/api', refRoute);
app.use('/api', customerRoutes);
app.use('/api', affiliateRoutes);
app.use('/api/affiliate', affiliateDashboardRoutes);
app.use('/api', adminRoutes);
app.use('/api/support', supportRoutes);

// Dynamic verification pages (no CSRF needed)
app.get('/verify-email/:token', pageController.verifyEmailPage);
app.get('/reset-password/:token', pageController.resetPasswordPage);
app.post('/api/auth/resend-verification', pageController.resendVerificationEmail);

// Static files (frontend) - Updated to serve from ahoyvpn-frontend directory
app.use(express.static(path.join(__dirname, '../../ahoyvpn-frontend/out')));

// Dashboard page (protected)
app.get('/dashboard', protect, (req, res) => {
  res.sendFile(path.join(__dirname, '../../ahoyvpn-frontend/out/dashboard.html'));
});

// Admin dashboard (protected)
app.get('/admin', protect, (req, res) => {
  res.sendFile(path.join(__dirname, '../../ahoyvpn-frontend/out/admin.html'));
});

// Affiliate dashboard (protected)
app.get('/affiliate-dashboard', protect, (req, res) => {
  res.sendFile(path.join(__dirname, '../../ahoyvpn-frontend/out/affiliate.html'));
});

// Root route - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../ahoyvpn-frontend/out/index.html'));
});
// Register route - serve register.html
app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "../../ahoyvpn-frontend/out/register.html"));
});

// Login route - serve login.html
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "../../ahoyvpn-frontend/out/login.html"));
});

// Recover route - serve recover.html
app.get("/recover", (req, res) => {
  res.sendFile(path.join(__dirname, "../../ahoyvpn-frontend/out/recover.html"));
});

// Checkout route - serve checkout.html
app.get("/checkout", (req, res) => {
  res.sendFile(path.join(__dirname, "../../ahoyvpn-frontend/out/checkout.html"));
});

// Downloads route - serve downloads.html
app.get("/downloads", (req, res) => {
  res.sendFile(path.join(__dirname, "../../ahoyvpn-frontend/out/downloads.html"));
});

// FAQ route - serve faq.html
app.get("/faq", (req, res) => {
  res.sendFile(path.join(__dirname, "../../ahoyvpn-frontend/out/faq.html"));
});

// Privacy route - serve privacy.html
app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "../../ahoyvpn-frontend/out/privacy.html"));
});

// TOS route - serve tos.html
app.get("/tos", (req, res) => {
  res.sendFile(path.join(__dirname, "../../ahoyvpn-frontend/out/tos.html"));
});

// Error handling
app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`🚀 AhoyVPN backend running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  console.log(`🔒 Security: CSP enabled, Script monitoring ${scriptMonitor.monitoringEnabled ? 'enabled' : 'disabled'}`);
});

// Cleanup scheduler (run every hour)
if (process.env.DISABLE_CLEANUP !== 'true') {
  const cleanupService = require('./services/cleanupService');
  setInterval(() => {
    cleanupService.runAllCleanup();
  }, 60 * 60 * 1000); // every hour
  
  // Run once on startup after a short delay
  setTimeout(() => {
    cleanupService.runAllCleanup();
  }, 30 * 1000);
}

// Plisio invoice polling fallback (15/30/45 minute checkpoints)
if (process.env.DISABLE_PLISIO_POLLING !== 'true') {
  const invoicePollingService = require('./services/invoicePollingService');

  setInterval(() => {
    invoicePollingService.runOnce().catch((error) => {
      log.error('Invoice polling run failed', { error: error.message });
    });
    // Also poll ARB subscriptions for Authorize.net fiat payments
    invoicePollingService.pollArbSubscriptions().catch((error) => {
      log.error('ARB polling run failed', { error: error.message });
    });
  }, 5 * 60 * 1000); // every 5 minutes

  // First run shortly after startup
  setTimeout(() => {
    invoicePollingService.runOnce().catch((error) => {
      log.error('Initial invoice polling run failed', { error: error.message });
    });
    setTimeout(() => {
      invoicePollingService.pollArbSubscriptions().catch((error) => {
        log.error('Initial ARB polling run failed', { error: error.message });
      });
    }, 30 * 1000);
  }, 45 * 1000);
}

// Payment event processor — retry queue for all payment-adjacent operations
try {
  const { start: startPaymentProcessor } = require('./services/paymentEventProcessor');
  startPaymentProcessor();
  log.info('[index] paymentEventProcessor started (every 5 minutes)');
} catch (err) {
  log.error('[index] Failed to start paymentEventProcessor', { error: err.message });
}

module.exports = server;
