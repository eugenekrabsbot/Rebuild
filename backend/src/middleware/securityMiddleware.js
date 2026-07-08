const crypto = require('crypto');
const log = require('../utils/logger');

/**
 * Enhanced Content Security Policy configuration
 * Optimized for PCI DSS compliance and payment security
 */
const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    fontSrc: ["'self'", "https:", "data:"],
    formAction: [
      "'self'",
      "https://plisio.com",
      "https://*.plisio.com",
      "https://paymentscloud.com",
      "https://*.paymentscloud.com",
    ],
    frameAncestors: ["'none'"],
    imgSrc: [
      "'self'",
      "data:",
      "https:",
      "blob:"
    ],
    objectSrc: ["'none'"],
    scriptSrc: [
      "'self'",
      "https://static.cloudflareinsights.com",
      "https://js.plisio.com",
      "https://*.plisio.com",
      "https://paymentscloud.com",
      "https://*.paymentscloud.com",
    ],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "https:", "'unsafe-inline'"],
    connectSrc: [
      "'self'",
      "https://api.plisio.com",
      "https://*.plisio.com",
      "https://api.paymentscloud.com",
      "https://*.paymentscloud.com",
      "https://maps.googleapis.com"
    ],
    mediaSrc: ["'self'"],
    workerSrc: ["'none'"],
  },
  reportOnly: false,
  reportUri: '/api/security/csp-report'
};

/**
 * Script integrity monitoring middleware
 * Checks payment scripts for unauthorized modifications
 */
class ScriptIntegrityMonitor {
  constructor() {
    this.scriptHashes = new Map();
    this.monitoringEnabled = process.env.NODE_ENV === 'production';
  }

  /**
   * Generate SRI hash for a script
   */
  generateSRIHash(content) {
    const hash = crypto.createHash('sha384').update(content).digest('base64');
    return `sha384-${hash}`;
  }

  /**
   * Register expected script hashes
   */
  registerScript(url, expectedHash) {
    this.scriptHashes.set(url, expectedHash);
  }

  /**
   * Verify script integrity
   */
  async verifyScriptIntegrity(url, content) {
    if (!this.monitoringEnabled) return true;

    const expectedHash = this.scriptHashes.get(url);
    if (!expectedHash) {
      log.warn('No expected hash registered for script', { url });
      return false;
    }

    const actualHash = this.generateSRIHash(content);
    const isValid = actualHash === expectedHash;

    if (!isValid) {
      log.error('Script integrity check failed', { url, expectedHash, actualHash });

      // Alert on integrity failure
      this.alertIntegrityFailure(url, expectedHash, actualHash);
    }

    return isValid;
  }

  /**
   * Alert on integrity failure
   */
  alertIntegrityFailure(url, expected, actual) {
    // Log to security audit
    const auditLog = {
      timestamp: new Date().toISOString(),
      type: 'SCRIPT_INTEGRITY_FAILURE',
      url,
      expectedHash: expected,
      actualHash: actual,
      severity: 'HIGH'
    };

    // In production, send to security monitoring system
    if (process.env.NODE_ENV === 'production') {
      // TODO: Integrate with security monitoring service
      // Use structured logger so the severity prefix is always present
      log.error('SECURITY ALERT: SCRIPT_INTEGRITY_FAILURE', { auditLog });
    }
  }

  /**
   * Middleware to check script integrity
   */
  middleware() {
    return (req, res, next) => {
      if (!this.monitoringEnabled) {
        return next();
      }

      // Check for script-related requests
      const url = req.url;
      if (url.includes('.js') || url.includes('/scripts/')) {
        // In a real implementation, you would fetch and verify the script
        // For now, we'll log the request
        log.debug('Script request', { url });
      }

      next();
    };
  }
}

/**
 * Payment page security middleware
 */
const paymentSecurityMiddleware = (req, res, next) => {
  // Only apply to payment-related routes
  if (!req.path.includes('/payment') && !req.path.includes('/checkout')) {
    return next();
  }

  // Set security headers for payment pages
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Prevent caching of sensitive payment pages
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  next();
};

/**
 * CSP report endpoint handler
 */
const handleCSPReport = (req, res) => {
  const report = req.body;

  log.warn('CSP Violation Report', { report });

  // Log to security audit
  const auditLog = {
    timestamp: new Date().toISOString(),
    type: 'CSP_VIOLATION',
    report,
    severity: 'MEDIUM'
  };

  // In production, send to security monitoring
  if (process.env.NODE_ENV === 'production') {
    // TODO: Integrate with security monitoring service
    log.error('SECURITY ALERT: CSP Violation', { auditLog });
  }

  res.status(204).end();
};

module.exports = {
  cspConfig,
  ScriptIntegrityMonitor,
  paymentSecurityMiddleware,
  handleCSPReport
};
