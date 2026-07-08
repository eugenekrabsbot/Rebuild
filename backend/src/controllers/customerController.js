const argon2 = require('argon2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const { generateCsrfToken, storeCsrfToken, setCsrfTokenCookie } = require('../middleware/authMiddleware_new');
const { validatePasswordComplexity } = require('../middleware/passwordValidation');
const log = require('../utils/logger');

// Generate numeric account number (8 digits)
function generateAccountNumber() {
  return String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}

// Generate numeric password (8 digits)
function generateNumericPassword() {
  return String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}

// Generate recovery kit (32 characters)
function generateRecoveryKit() {
  return crypto.randomBytes(16).toString('hex');
}

// Hash recovery kit
async function hashRecoveryKit(kit) {
  return await argon2.hash(kit);
}

// Verify recovery kit
async function verifyRecoveryKit(kit, hash) {
  return await argon2.verify(hash, kit);
}

// Login endpoint
const login = async (req, res) => {
  try {
    const { accountNumber, password } = req.body;
    
    if (!accountNumber || !password) {
      return res.status(400).json({ error: 'Account number and password are required' });
    }
    
    // Find user by account number
    const userResult = await db.query(
      'SELECT id, account_number, password_hash, numeric_password_hash, is_active, lockout_until, failed_attempts FROM users WHERE account_number = $1',
      [accountNumber]
    );
    
    if (userResult.rows.length === 0) {
      // Increment failed attempts
      await db.query(
        'UPDATE users SET failed_attempts = COALESCE(failed_attempts, 0) + 1, lockout_until = CASE WHEN COALESCE(failed_attempts, 0) >= 4 THEN NOW() + INTERVAL \'15 minutes\' ELSE lockout_until END WHERE account_number = $1',
        [accountNumber]
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = userResult.rows[0];
    
    // Note: is_active=false means unpaid account, NOT deactivated.
    // Users must log in to purchase a plan, so we allow login for inactive accounts.
    
    // Check if account is locked
    if (user.lockout_until && new Date(user.lockout_until) > new Date()) {
      return res.status(423).json({ 
        error: 'Account temporarily locked. Please try again later.',
        lockoutUntil: user.lockout_until
      });
    }
    
    // Verify password — try numeric_password_hash first, fall back to password_hash
    let isValid = false;
    const hashToCheck = user.numeric_password_hash || user.password_hash;
    if (!hashToCheck) {
      // No password set — invalid
      isValid = false;
    } else if (hashToCheck.startsWith('$2')) {
      // Legacy bcrypt hash
      isValid = await bcrypt.compare(password, hashToCheck);
    } else {
      // Argon2 hash
      try {
        isValid = await argon2.verify(hashToCheck, password);
      } catch (e) {
        isValid = false;
      }
    }
    if (!isValid) {
      // Increment failed attempts
      await db.query(
        'UPDATE users SET failed_attempts = COALESCE(failed_attempts, 0) + 1, lockout_until = CASE WHEN COALESCE(failed_attempts, 0) >= 4 THEN NOW() + INTERVAL \'15 minutes\' ELSE lockout_until END WHERE account_number = $1',
        [accountNumber]
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Reset failed attempts on successful login
    await db.query(
      'UPDATE users SET failed_attempts = 0, lockout_until = NULL, last_login = NOW() WHERE account_number = $1',
      [accountNumber]
    );
    
    // Generate JWT tokens
    const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ userId: user.id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
    
    // Set cookies
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000
    });
    
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    // Set CSRF token
    setCsrfTokenCookie(res, user.id);
    
    res.json({
      success: true,
      data: {
        accountNumber: user.account_number,
        message: 'Login successful'
      }
    });
  } catch (error) {
    log.error('Login error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Register endpoint (for numeric accounts)
const register = async (req, res) => {
  try {
    const { email } = req.body;
    
    // Email is optional
    if (email) {
      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }
    
    // Generate numeric credentials
    const accountNumber = generateAccountNumber();
    const numericPassword = generateNumericPassword();
    const numericPasswordHash = await argon2.hash(numericPassword);
    
    // Create user
    const userResult = await db.query(
      `INSERT INTO users (
        email, account_number, numeric_password_hash, 
        is_numeric_account, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, account_number`,
      [email, accountNumber, numericPasswordHash, true, true]
    );
    
    const user = userResult.rows[0];
    
    // Create initial recovery kit
    const recoveryKit = generateRecoveryKit();
    const kitHash = await hashRecoveryKit(recoveryKit);
    
    await db.query(
      `INSERT INTO recovery_kits (user_id, kit_hash, is_active, created_at)
       VALUES ($1, $2, true, NOW())`,
      [user.id, kitHash]
    );
    
    // Generate JWT tokens
    const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ userId: user.id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
    
    // Set cookies
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000
    });
    
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    // Set CSRF token
    setCsrfTokenCookie(res, user.id);
    
    res.status(201).json({
      success: true,
      data: {
        accountNumber: user.account_number,
        numericPassword: numericPassword, // Only shown once
        recoveryKit: recoveryKit, // Only shown once
        message: 'Account created. Save your credentials securely.'
      }
    });
  } catch (error) {
    log.error('Registration error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Claim credentials endpoint (post-payment)
const claimCredentials = async (req, res) => {
  try {
    const { claimToken } = req.body;
    
    if (!claimToken) {
      return res.status(400).json({ error: 'Claim token required' });
    }
    
    // Hash the claim token
    const tokenHash = await argon2.hash(claimToken);
    
    // Find the claim record
    const claimResult = await db.query(
      `SELECT cc.*, u.account_number, u.numeric_password_hash
       FROM credential_claims cc
       JOIN users u ON cc.customer_id = u.id
       WHERE cc.claim_token_hash = $1 AND cc.expires_at > NOW() AND cc.claimed_at IS NULL`,
      [tokenHash]
    );
    
    if (claimResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired claim token' });
    }
    
    const claim = claimResult.rows[0];
    
    // Mark claim as used
    await db.query(
      'UPDATE credential_claims SET claimed_at = NOW() WHERE id = $1',
      [claim.id]
    );
    
    // Generate new recovery kit
    const recoveryKit = generateRecoveryKit();
    const kitHash = await hashRecoveryKit(recoveryKit);
    
    // Replace any existing kits with a single fresh active kit.
    await db.query('DELETE FROM recovery_kits WHERE user_id = $1', [claim.customer_id]);

    await db.query(
      `INSERT INTO recovery_kits (user_id, kit_hash, is_active, created_at)
       VALUES ($1, $2, true, NOW())`,
      [claim.customer_id, kitHash]
    );
    
    res.json({
      success: true,
      data: {
        accountNumber: claim.account_number,
        numericPassword: await argon2.hash(claim.numeric_password_hash), // Return hash for verification
        recoveryKit: recoveryKit,
        message: 'Credentials claimed successfully. Save them securely.'
      }
    });
  } catch (error) {
    log.error('Claim credentials error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Use recovery kit endpoint
const useRecoveryKit = async (req, res) => {
  try {
    const { accountNumber, kit, newPassword } = req.body;

    if (!accountNumber || !kit || !newPassword) {
      return res.status(400).json({ error: 'Account number, recovery kit, and new password are required' });
    }

    const passwordValidation = validatePasswordComplexity(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: 'Password validation failed',
        message: passwordValidation.errors.join(', ')
      });
    }

    // Find user
    const userResult = await db.query(
      'SELECT id, account_number FROM users WHERE account_number = $1',
      [accountNumber]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const user = userResult.rows[0];

    // Find active recovery kit
    const kitResult = await db.query(
      'SELECT id, kit_hash FROM recovery_kits WHERE user_id = $1 AND is_active = true AND used_at IS NULL AND revoked_at IS NULL',
      [user.id]
    );

    if (kitResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active recovery kit found' });
    }

    const kitRecord = kitResult.rows[0];

    // Verify kit
    const isValid = await verifyRecoveryKit(kit, kitRecord.kit_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid recovery kit' });
    }

    await db.query('BEGIN');

    try {
      // Update password for both current (bcrypt) and legacy (argon2) login paths
      const bcryptPasswordHash = await bcrypt.hash(newPassword, 10);
      const argonPasswordHash = await argon2.hash(newPassword);
      await db.query(
        `UPDATE users
         SET password_hash = $1,
             numeric_password_hash = $2,
             password_changed_at = NOW(),
             force_password_change = false,
             updated_at = NOW()
         WHERE id = $3`,
        [bcryptPasswordHash, argonPasswordHash, user.id]
      );

      // Keep a single active kit row per user to satisfy current DB constraint.
      await db.query('DELETE FROM recovery_kits WHERE user_id = $1', [user.id]);

      // Generate new recovery kit
      const newKit = generateRecoveryKit();
      const newKitHash = await hashRecoveryKit(newKit);

      await db.query(
        `INSERT INTO recovery_kits (user_id, kit_hash, is_active, created_at)
         VALUES ($1, $2, true, NOW())`,
        [user.id, newKitHash]
      );

      await db.query('COMMIT');

      return res.json({
        success: true,
        data: {
          recoveryKit: newKit,
          message: 'Recovery successful. Your password has been updated and a new recovery kit was generated.'
        }
      });
    } catch (txError) {
      await db.query('ROLLBACK');
      throw txError;
    }
  } catch (error) {
    log.error('Use recovery kit error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Rotate recovery kit endpoint
const debugRotateKit = async (req, res) => {
  res.json({ debug: true, user: req.user?.id, cookies: Object.keys(req.cookies || {}), path: req.originalUrl });
};
const rotateRecoveryKit = async (req, res) => {
  console.log('[rotateRecoveryKit] START — body:', JSON.stringify(req.body).slice(0, 100));
  console.log('[rotateRecoveryKit] user:', req.user);
  console.log('[rotateRecoveryKit] cookies:', JSON.stringify(Object.keys(req.cookies || {})));
  console.log('[rotateRecoveryKit] path:', req.originalUrl);
  try {
    console.log('rotate-kit reached — user:', req.user?.id, 'body has password:', !!req.body.password);
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    // Verify password (support both legacy argon2 and current bcrypt hashes)
    const userResult = await db.query(
      'SELECT id, numeric_password_hash, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    let isValid = false;

    if (user.password_hash) {
      try {
        isValid = await bcrypt.compare(password, user.password_hash);
      } catch (_) {}
    }

    if (!isValid && user.numeric_password_hash) {
      try {
        isValid = await argon2.verify(user.numeric_password_hash, password);
      } catch (_) {}
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Generate new kit
    const newKit = generateRecoveryKit();
    const newKitHash = await hashRecoveryKit(newKit);

    // Keep one active kit row per user to satisfy DB uniqueness rules.
    await db.query('DELETE FROM recovery_kits WHERE user_id = $1', [req.user.id]);

    await db.query(
      `INSERT INTO recovery_kits (user_id, kit_hash, is_active, created_at)
       VALUES ($1, $2, true, NOW())`,
      [req.user.id, newKitHash]
    );

    res.json({
      success: true,
      data: {
        recoveryKit: newKit,
        message: 'Recovery kit rotated successfully.'
      }
    });
  } catch (error) {
    log.error('Rotate recovery kit error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Logout endpoint
const logout = async (req, res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.clearCookie('csrfToken');
  res.json({ success: true, message: 'Logged out successfully' });
};

// Change password endpoint
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    // Verify current password (support both hash formats)
    const userResult = await db.query(
      'SELECT id, numeric_password_hash, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    let isValid = false;

    if (user.password_hash) {
      try {
        isValid = await bcrypt.compare(currentPassword, user.password_hash);
      } catch (_) {}
    }

    if (!isValid && user.numeric_password_hash) {
      try {
        isValid = await argon2.verify(user.numeric_password_hash, currentPassword);
      } catch (_) {}
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Write both hashes for backward compatibility with legacy auth paths
    const newBcryptHash = await bcrypt.hash(newPassword, 10);
    const newArgonHash = await argon2.hash(newPassword);

    await db.query(
      'UPDATE users SET password_hash = $1, numeric_password_hash = $2, updated_at = NOW() WHERE id = $3',
      [newBcryptHash, newArgonHash, req.user.id]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    log.error('Change password error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get profile endpoint
const getProfile = async (req, res) => {
  try {
    const userResult = await db.query(
      `SELECT u.account_number,
              u.created_at,
              u.updated_at,
              u.last_login,
              u.is_active,
              va.vpn_username AS vpn_username,
              va.vpn_password AS vpn_password,
              va.status AS vpn_status,
              va.expiry_date AS vpn_expiry_date
       FROM users u
       LEFT JOIN vpn_accounts va ON va.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const row = userResult.rows[0];

    // Get external access key if subscription is active
    const { getActiveKey } = require('../services/accessKeyService');
    const activeKey = await getActiveKey(req.user.id);

    // Get subscription status for the key display
    const subResult = await db.query(
      `SELECT status FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [req.user.id]
    );
    const subscriptionActive = subResult.rows.length > 0;

    res.json({
      success: true,
      data: {
        ...row,
        subscriptionActive,
        externalAccessKey: subscriptionActive ? activeKey?.access_key : null,
        externalAccessKeyRotatedAt: subscriptionActive ? activeKey?.rotated_at : null,
      }
    });
  } catch (error) {
    log.error('Get profile error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get subscription endpoint
const getSubscription = async (req, res) => {
  try {
    const subscriptionResult = await db.query(
      `SELECT s.*, p.name as plan_name, p.interval, p.amount_cents, p.currency
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [req.user.id]
    );
    
    if (subscriptionResult.rows.length === 0) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    const subscription = subscriptionResult.rows[0];
    // Map interval to plan_key (used by frontend)
    const intervalMap = {
      'month': 'monthly',
      'quarter': 'quarterly',
      'semi_annual': 'semiAnnual',
      'year': 'annual'
    };
    subscription.plan_key = intervalMap[subscription.interval] || subscription.interval;
    // Also provide camelCase version for frontend compatibility
    subscription.planKey = subscription.plan_key;
    
    res.json({
      success: true,
      data: subscription
    });
  } catch (error) {
    log.error('Get subscription error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Cancel subscription endpoint
const cancelSubscription = async (req, res) => {
  try {
    // First get the subscription (with status check)
    const subQuery = await db.query(
      `SELECT id, metadata FROM subscriptions
       WHERE user_id = $1 AND status = 'active'
       LIMIT 1`,
      [req.user.id]
    );

    if (subQuery.rows.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Update subscription status to cancelled
    await db.query(
      `UPDATE subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [subscription.id]
    );

    // Revoke external access key
    const { revokeAccessKey } = require('../services/accessKeyService');
    await revokeAccessKey(req.user.id);

    res.json({
      success: true,
      message: 'Subscription cancelled successfully'
    });
  } catch (error) {
    log.error('Cancel subscription error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Change plan endpoint
const changePlan = async (req, res) => {
  try {
    const { newPlanKey } = req.body;
    
    if (!newPlanKey) {
      return res.status(400).json({ error: 'New plan key required' });
    }
    
    // Get plan ID
    const planResult = await db.query(
      "SELECT id FROM plans WHERE name ILIKE $1 LIMIT 1",
      [newPlanKey.replace(/([A-Z])/g, ' $1').trim()]
    );
    
    if (planResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    // Update subscription
    const subscriptionResult = await db.query(
      `UPDATE subscriptions 
       SET plan_id = $1, updated_at = NOW()
       WHERE user_id = $2 AND status = 'active'
       RETURNING *`,
      [planResult.rows[0].id, req.user.id]
    );
    
    if (subscriptionResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }
    
    res.json({
      success: true,
      message: 'Plan changed successfully'
    });
  } catch (error) {
    log.error('Change plan error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete account endpoint
const deleteAccount = async (req, res) => {
  try {
    // Soft delete
    await db.query(
      'UPDATE users SET is_active = false, deleted_at = NOW() WHERE id = $1',
      [req.user.id]
    );
    
    res.json({
      success: true,
      message: 'Account scheduled for deletion. You will lose access in 30 days.'
    });
  } catch (error) {
    log.error('Delete account error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get messages endpoint
const getMessages = async (req, res) => {
  try {
    const messagesResult = await db.query(
      `SELECT id, subject, message, is_read, created_at
       FROM internal_messages
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    
    res.json({
      success: true,
      data: messagesResult.rows
    });
  } catch (error) {
    log.error('Get messages error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Create support ticket endpoint
const createSupportTicket = async (req, res) => {
  try {
    const { subject, description } = req.body;
    
    if (!subject || !description) {
      return res.status(400).json({ error: 'Subject and description required' });
    }
    
    const ticketResult = await db.query(
      `INSERT INTO support_tickets (user_id, subject, description, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'open', NOW(), NOW())
       RETURNING id, subject, status, created_at`,
      [req.user.id, subject, description]
    );
    
    res.json({
      success: true,
      data: ticketResult.rows[0],
      message: 'Support ticket created successfully'
    });
  } catch (error) {
    log.error('Create support ticket error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};




module.exports = {
  login,
  register,
  claimCredentials,
  useRecoveryKit,
  rotateRecoveryKit,
  logout,
  changePassword,
  getProfile,
  getSubscription,
  cancelSubscription,
  changePlan,
  deleteAccount,
  getMessages,
  createSupportTicket
};
