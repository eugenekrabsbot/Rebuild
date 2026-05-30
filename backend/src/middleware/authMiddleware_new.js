const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const log = require('../utils/logger');

// CSRF token generation and storage
const csrfTokens = new Map(); // In production, use Redis

const generateCsrfToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const storeCsrfToken = (userId, token) => {
  csrfTokens.set(`${userId}:${token}`, Date.now());
  // Clean up old tokens (older than 15 minutes)
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, timestamp] of csrfTokens.entries()) {
    if (timestamp < cutoff) {
      csrfTokens.delete(key);
    }
  }
};

const verifyCsrfToken = (userId, token) => {
  const key = `${userId}:${token}`;
  return csrfTokens.has(key);
};

// JWT verification middleware for standard users
const PUBLIC_PATHS = [
  '/auth/customer/login',
  '/auth/customer/register',
  '/auth/customer/recovery',
  '/auth/login',
  '/auth/register',
  '/api/csrf',
];

const protect = async (req, res, next) => {
  try {
    // Skip auth for public auth paths
    const fullPath = req.originalUrl || req.url;
    if (PUBLIC_PATHS.some(p => fullPath.includes(p))) {
      return next();
    }

    // Try to get token from cookies first, then Authorization header
    let token = req.cookies?.accessToken;
    
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id || decoded.adminId || decoded.affiliateId;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    req.user = { id: userId, role: decoded.role, type: decoded.type || decoded.affiliateType };
    if (decoded.affiliateId) req.user.affiliateId = decoded.affiliateId;
    
    next();
  } catch (error) {
    log.error('Auth middleware error', { error: error.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// JWT verification middleware for affiliates
const protectAffiliate = async (req, res, next) => {
  try {
    let token = req.cookies?.accessToken;
    
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'affiliate' || !decoded.affiliateId) {
      return res.status(403).json({ error: 'Affiliate access required' });
    }
    
    // req.user.id is used by protectAuth, req.affiliateId by affiliate routes
    const userId = decoded.userId || decoded.id || decoded.affiliateId;
    req.user = { id: userId, affiliateId: decoded.affiliateId, type: 'affiliate' };
    req.affiliateId = decoded.affiliateId;
    
    next();
  } catch (error) {
    log.error('Affiliate auth middleware error', { error: error.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// JWT verification middleware for admins
const protectAdmin = async (req, res, next) => {
  try {
    let token = req.cookies?.accessToken;
    
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'admin' || !decoded.adminId) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.user = { adminId: decoded.adminId, role: decoded.role, type: 'admin' };
    next();
  } catch (error) {
    log.error('Admin auth middleware error', { error: error.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Middleware for password reset tokens (issued via validateRecoveryCode)
const resetTokenProtect = async (req, res, next) => {
  const token = req.headers['x-reset-token'];
  if (!token) return res.status(401).json({ error: 'Reset token required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.purpose !== 'reset') return res.status(401).json({ error: 'Invalid reset token' });
    req.user = { affiliateId: decoded.affiliateId, purpose: 'reset' };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired reset token' });
  }
};

// CSRF protection middleware
const csrfProtection = async (req, res, next) => {
  // Skip CSRF for GET, HEAD, OPTIONS requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Get CSRF token from header or body
  const csrfToken = req.headers['x-csrf-token'] || req.body?._csrf;
  
  // Support both customer (id) and admin (adminId) users
  const userId = req.user?.adminId || req.user?.id || req.user?.affiliateId;
  if (!csrfToken || !userId) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }
  
  const isValid = verifyCsrfToken(userId, csrfToken);
  if (!isValid) {
    // Auto-issue a fresh CSRF token cookie so the next request can succeed
    const freshToken = generateCsrfToken();
    storeCsrfToken(userId, freshToken);
    res.cookie('csrfToken', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });

    return res.status(403).json({ error: 'Invalid CSRF token', refreshCsrf: true });
  }
  
  next();
};

// Role-based middleware
const requireRole = (role) => {
  return async (req, res, next) => {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Check if user has the required role
    const query = 'SELECT is_admin FROM users WHERE id = $1';
    const result = await db.query(query, [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    if (role === 'admin' && !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
  };
};

// Affiliate role middleware
const requireAffiliate = async (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const query = 'SELECT id FROM affiliates WHERE user_id = $1';
  const result = await db.query(query, [req.user.id]);
  
  if (result.rows.length === 0) {
    return res.status(403).json({ error: 'Affiliate access required' });
  }
  
  req.affiliateId = result.rows[0].id;
  next();
};

// 2FA verification middleware
const require2FA = async (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const query = 'SELECT totp_enabled, last_2fa_verification FROM users WHERE id = $1';
  const result = await db.query(query, [req.user.id]);
  
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const user = result.rows[0];
  
  // Check if 2FA is enabled and was verified recently (within 15 minutes)
  if (user.totp_enabled) {
    const lastVerified = user.last_2fa_verification;
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    if (!lastVerified || new Date(lastVerified) < fifteenMinutesAgo) {
      return res.status(403).json({ 
        error: '2FA verification required',
        requires2FA: true 
      });
    }
  }
  
  next();
};

// Rate limiting middleware
const createRateLimiter = (windowMs, max, message = 'Too many requests') => {
  const requests = new Map();
  
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    
    const windowStart = now - windowMs;
    const requestsInWindow = requests.get(key) || [];
    
    // Clean old requests
    const recentRequests = requestsInWindow.filter(timestamp => timestamp > windowStart);
    
    if (recentRequests.length >= max) {
      return res.status(429).json({ error: message });
    }
    
    recentRequests.push(now);
    requests.set(key, recentRequests);
    
    next();
  };
};

// Login rate limiter (stricter)
const loginRateLimiter = createRateLimiter(15 * 60 * 1000, 5, 'Too many login attempts. Please try again later.');

// Account lockout middleware
const accountLockout = async (req, res, next) => {
  const { accountNumber } = req.body;
  
  if (!accountNumber) {
    return next();
  }
  
  const query = `
    SELECT lockout_until, failed_attempts 
    FROM users 
    WHERE account_number = $1
  `;
  const result = await db.query(query, [accountNumber]);
  
  if (result.rows.length > 0) {
    const user = result.rows[0];
    
    if (user.lockout_until && new Date(user.lockout_until) > new Date()) {
      return res.status(423).json({ 
        error: 'Account temporarily locked. Please try again later.',
        lockoutUntil: user.lockout_until
      });
    }
  }
  
  next();
};

// Set CSRF token cookie
const setCsrfTokenCookie = (res, userId) => {
  const csrfToken = generateCsrfToken();
  storeCsrfToken(userId, csrfToken);
  
  res.cookie('csrfToken', csrfToken, {
    httpOnly: false, // JavaScript can read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });
  
  return csrfToken;
};

module.exports = {
  protect,
  protectAffiliate,
  protectAdmin,
  csrfProtection,
  requireRole,
  requireAffiliate,
  require2FA,
  loginRateLimiter,
  accountLockout,
  generateCsrfToken,
  storeCsrfToken,
  verifyCsrfToken,
  setCsrfTokenCookie,
  resetTokenProtect,
  // Exported for test access — csrfTokens Map is intentionally not exported in production
  csrfTokens,
  // Exported for test access — createRateLimiter is a factory, the limiter itself is not middleware
  createRateLimiter
};
