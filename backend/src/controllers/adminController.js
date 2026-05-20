const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const { setCsrfTokenCookie } = require('../middleware/authMiddleware_new');
const log = require('../utils/logger');

// Login endpoint for admins
const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Find admin user
    const adminResult = await db.query(
      'SELECT id, username, password_hash, role, is_active FROM admin_users WHERE username = $1 AND is_active = true',
      [username]
    );
    
    if (adminResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const admin = adminResult.rows[0];
    
    // Verify password
    const isValid = await argon2.verify(admin.password_hash, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    await db.query(
      'UPDATE admin_users SET last_login = NOW() WHERE id = $1',
      [admin.id]
    );
    
    // Generate JWT tokens
    const accessToken = jwt.sign({ adminId: admin.id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ adminId: admin.id, role: admin.role }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
    
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
    setCsrfTokenCookie(res, admin.id);
    
    res.json({
      success: true,
      data: {
        username: admin.username,
        role: admin.role,
        message: 'Admin login successful'
      }
    });
  } catch (error) {
    log.error('Admin login error', { error: error.message });
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

// Get customers endpoint
const getCustomers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT u.id, u.account_number, u.created_at, u.last_login, u.is_active,
             s.status as subscription_status, s.current_period_end
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
      WHERE u.is_numeric_account = true
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (search) {
      query += ` AND u.account_number ILIKE $${paramCount}`;
      params.push(`%${search}%`);
      paramCount++;
    }
    
    query += ` ORDER BY u.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);
    
    const customersResult = await db.query(query, params);
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM users
      WHERE is_numeric_account = true
      ${search ? 'AND account_number ILIKE $1' : ''}
    `;
    const countResult = await db.query(countQuery, search ? [`%${search}%`] : []);
    
    res.json({
      success: true,
      data: customersResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    log.error('Get customers error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get customer endpoint
const getCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    
    const customerResult = await db.query(
      `SELECT u.id, u.account_number, u.created_at, u.last_login, u.is_active,
              s.status as subscription_status, s.current_period_end, s.plan_id,
              va.vpn_username, va.expiry_date as vpn_expiry_date
       FROM users u
       LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
       LEFT JOIN vpn_accounts va ON u.id = va.user_id
       WHERE u.id = $1 AND u.is_numeric_account = true`,
      [id]
    );
    
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json({
      success: true,
      data: customerResult.rows[0]
    });
  } catch (error) {
    log.error('Get customer error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Reset customer password endpoint
const resetCustomerPassword = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Generate new numeric password
    const newPassword = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
    const newPasswordHash = await argon2.hash(newPassword);
    
    // Update password
    await db.query(
      'UPDATE users SET numeric_password_hash = $1 WHERE id = $2',
      [newPasswordHash, id]
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at)
       VALUES ('admin', $1, 'reset_customer_password', 'customer', $2, NOW())`,
      [req.user.id, id]
    );
    
    res.json({
      success: true,
      data: { newPassword },
      message: 'Password reset successfully'
    });
  } catch (error) {
    log.error('Reset customer password error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Rotate customer recovery kit endpoint
const rotateCustomerRecoveryKit = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Deactivate existing active kit
    await db.query(
      'UPDATE recovery_kits SET is_active = false, revoked_at = NOW() WHERE user_id = $1 AND is_active = true',
      [id]
    );
    
    // Generate new kit
    const newKit = crypto.randomBytes(16).toString('hex');
    const kitHash = await argon2.hash(newKit);
    
    await db.query(
      `INSERT INTO recovery_kits (user_id, kit_hash, is_active, created_at)
       VALUES ($1, $2, true, NOW())`,
      [id, kitHash]
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at)
       VALUES ('admin', $1, 'rotate_recovery_kit', 'customer', $2, NOW())`,
      [req.user.id, id]
    );
    
    res.json({
      success: true,
      data: { recoveryKit: newKit },
      message: 'Recovery kit rotated successfully'
    });
  } catch (error) {
    log.error('Rotate customer recovery kit error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Rotate external access key for ahoyvpn.com
const rotateExternalAccessKey = async (req, res) => {
  try {
    const { id } = req.params;
    const { rotateKey } = require('../services/accessKeyService');
    
    const newKey = await rotateKey(parseInt(id, 10));
    
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at)
       VALUES ('admin', $1, 'rotate_external_access_key', 'customer', $2, NOW())`,
      [req.user.id, id]
    );
    
    res.json({
      success: true,
      data: { accessKey: newKey },
      message: 'Access key rotated successfully'
    });
  } catch (error) {
    log.error('Rotate external access key error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Send message to customer endpoint
const sendMessageToCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, message } = req.body;
    
    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message required' });
    }
    
    const messageResult = await db.query(
      `INSERT INTO internal_messages (user_id, from_admin_id, subject, message, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, subject, created_at`,
      [id, req.user.id, subject, message]
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at, metadata)
       VALUES ('admin', $1, 'send_message', 'customer', $2, NOW(), $3)`,
      [req.user.id, id, JSON.stringify({ subject })]
    );
    
    res.json({
      success: true,
      data: messageResult.rows[0],
      message: 'Message sent successfully'
    });
  } catch (error) {
    log.error('Send message error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Deactivate customer endpoint
const deactivateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.query(
      'UPDATE users SET is_active = false WHERE id = $1',
      [id]
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at)
       VALUES ('admin', $1, 'deactivate_customer', 'customer', $2, NOW())`,
      [req.user.id, id]
    );
    
    res.json({
      success: true,
      message: 'Customer deactivated successfully'
    });
  } catch (error) {
    log.error('Deactivate customer error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete customer endpoint (soft delete)
const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.query(
      'UPDATE users SET is_active = false, deleted_at = NOW() WHERE id = $1',
      [id]
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at)
       VALUES ('admin', $1, 'delete_customer', 'customer', $2, NOW())`,
      [req.user.id, id]
    );
    
    res.json({
      success: true,
      message: 'Customer scheduled for deletion'
    });
  } catch (error) {
    log.error('Delete customer error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Create affiliate endpoint
const createAffiliate = async (req, res) => {
  try {
    // NOTE: Canonical commission rate is 10% (0.10). The payout_config table stores 0.10 for all plan
    // intervals. Using 0.10 here as the default ensures new affiliates get the correct rate unless
    // explicitly overridden. The 0.25 default was a historical mismatch that caused affiliates to be
    // created with an incorrect (higher-than-canonical) commission rate.
    const { userId, email, code, commissionRate = 0.10, isApproved = true, payoutMethod = 'crypto', walletAddress = null } = req.body;
    
    if (!userId && !email) {
      return res.status(400).json({ error: 'Either userId or email is required' });
    }
    
    // Find user by userId or email
    let user;
    if (userId) {
      const userResult = await db.query(
        'SELECT id, account_number FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      user = userResult.rows[0];
    } else {
      const userResult = await db.query(
        'SELECT id, account_number FROM users WHERE email = $1',
        [email]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found with that email' });
      }
      user = userResult.rows[0];
    }
    
    // Check if user already has an affiliate record
    const existingAffiliate = await db.query(
      'SELECT id FROM affiliates WHERE user_id = $1',
      [user.id]
    );
    if (existingAffiliate.rows.length > 0) {
      return res.status(400).json({ error: 'User is already an affiliate' });
    }
    
    // Generate affiliate code if not provided
    let affiliateCode = code;
    if (!affiliateCode) {
      // Generate a random 6-8 character alphanumeric code
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let generated = '';
      for (let i = 0; i < 8; i++) {
        generated += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      affiliateCode = generated;
    }
    
    // Ensure code is unique
    const codeCheck = await db.query(
      'SELECT id FROM affiliates WHERE code = $1',
      [affiliateCode]
    );
    if (codeCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Affiliate code already in use' });
    }
    
    // Generate a temporary password for the affiliate
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await argon2.hash(tempPassword);
    
    // Generate 10 recovery codes (like ahoymanController does)
    // recovery_codes_hash column stores a JSON array of argon2 hashes
    const codes = [];
    for (let i = 0; i < 10; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    const hashedCodes = await Promise.all(codes.map(c => argon2.hash(c)));

    // Create affiliate record
    const affiliateResult = await db.query(
      `INSERT INTO affiliates (
        user_id, username, password_hash, recovery_codes_hash, status, created_at
      ) VALUES ($1, $2, $3, $4, 'active', NOW())
      RETURNING id, username, status, created_at`,
      [user.id, affiliateCode, passwordHash, JSON.stringify(hashedCodes)]
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at, metadata)
       VALUES ('admin', $1, 'create_affiliate', 'affiliate', $2, NOW(), $3)`,
      [req.user.id, affiliateResult.rows[0].id, JSON.stringify({ username: affiliateCode })]
    );
    
    res.json({
      success: true,
      data: {
        ...affiliateResult.rows[0],
        account_number: user.account_number,
        tempPassword: tempPassword
      },
      message: 'Affiliate created successfully. Temporary password: ' + tempPassword
    });
  } catch (error) {
    log.error('Create affiliate error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get affiliates endpoint
const getAffiliates = async (req, res) => {
  try {
    const affiliatesResult = await db.query(
      `SELECT a.*, u.account_number,
        (SELECT COUNT(*) FROM referrals r WHERE r.affiliate_id = a.id AND r.status = 'active') as active_referrals,
        (SELECT SUM(commission_cents) FROM referrals r WHERE r.affiliate_id = a.id AND r.status = 'active') as total_commission_cents
       FROM affiliates a
       JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC`
    );
    
    res.json({
      success: true,
      data: affiliatesResult.rows
    });
  } catch (error) {
    log.error('Get affiliates error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get affiliate endpoint
const getAffiliate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const affiliateResult = await db.query(
      `SELECT a.*, u.account_number,
        (SELECT COUNT(*) FROM referrals r WHERE r.affiliate_id = a.id AND r.status = 'active') as active_referrals,
        (SELECT SUM(commission_cents) FROM referrals r WHERE r.affiliate_id = a.id AND r.status = 'active') as total_commission_cents
       FROM affiliates a
       JOIN users u ON a.user_id = u.id
       WHERE a.id = $1`,
      [id]
    );
    
    if (affiliateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Affiliate not found' });
    }
    
    res.json({
      success: true,
      data: affiliateResult.rows[0]
    });
  } catch (error) {
    log.error('Get affiliate error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Disable affiliate endpoint
const disableAffiliate = async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.query(
      'UPDATE affiliates SET status = $2 WHERE id = $1',
      [id, 'suspended']
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at)
       VALUES ('admin', $1, 'disable_affiliate', 'affiliate', $2, NOW())`,
      [req.user.id, id]
    );
    
    res.json({
      success: true,
      message: 'Affiliate disabled successfully'
    });
  } catch (error) {
    log.error('Disable affiliate error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Adjust affiliate earnings endpoint
const adjustAffiliateEarnings = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountCents, reason } = req.body;
    
    if (!amountCents) {
      return res.status(400).json({ error: 'Amount required' });
    }
    
    // Create adjustment transaction
    await db.query(
      `INSERT INTO transactions (id, affiliate_id, type, amount_cents, description, created_at)
       VALUES ($1, $2, 'adjustment', $3, $4, NOW())`,
      [require('crypto').randomBytes(16).toString('hex'), id, amountCents, reason || 'Manual adjustment by admin']
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at, metadata)
       VALUES ('admin', $1, 'adjust_earnings', 'affiliate', $2, NOW(), $3)`,
      [req.user.id, id, JSON.stringify({ amountCents, reason })]
    );
    
    res.json({
      success: true,
      message: 'Affiliate earnings adjusted successfully'
    });
  } catch (error) {
    log.error('Adjust affiliate earnings error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get KPIs endpoint
const getKPIs = async (req, res) => {
  try {
    const kpisResult = await db.query('SELECT * FROM admin_kpis');
    
    res.json({
      success: true,
      data: kpisResult.rows[0]
    });
  } catch (error) {
    log.error('Get KPIs error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Export affiliates CSV (payout summary)
const exportAffiliatesCSV = async (req, res) => {
  try {
    const affiliatesResult = await db.query(
      `SELECT a.id, a.username, a.status, a.created_at, u.account_number
       FROM affiliates a
       JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC`
    );

    // Get earnings for each affiliate
    const earningsResult = await db.query(
      `SELECT affiliate_id,
         COALESCE(SUM(CASE WHEN type = 'commission' AND paid_out_at IS NOT NULL THEN amount_cents ELSE 0 END), 0) as paid_out_cents,
         COALESCE(SUM(CASE WHEN type = 'commission' AND paid_out_at IS NULL THEN amount_cents ELSE 0 END), 0) as pending_payout_cents,
         COALESCE(SUM(CASE WHEN type = 'commission' THEN amount_cents ELSE 0 END), 0) as total_earned_cents
       FROM transactions
       WHERE affiliate_id IN (SELECT id FROM affiliates)
       GROUP BY affiliate_id`
    );
    
    // Create earnings map
    const earningsMap = {};
    earningsResult.rows.forEach(r => {
      earningsMap[r.affiliate_id] = r;
    });

    const csvHeader = 'Affiliate ID,Username,Account Number,Status,Total Earned ($),Pending Payout ($),Paid Out ($),Created At\n';
    
    const csvRows = affiliatesResult.rows.map(row => {
      const earnings = earningsMap[row.id] || { total_earned_cents: 0, pending_payout_cents: 0, paid_out_cents: 0 };
      const totalEarned = (earnings.total_earned_cents / 100).toFixed(2);
      const pendingPayout = (earnings.pending_payout_cents / 100).toFixed(2);
      const paidOut = (earnings.paid_out_cents / 100).toFixed(2);
      const createdAt = new Date(row.created_at).toISOString().split('T')[0];
      
      return `"${row.id}","${row.username}","${row.account_number}","${row.status}","${totalEarned}","${pendingPayout}","${paidOut}","${createdAt}"`;
    }).join('\n');

    const csvContent = csvHeader + csvRows;
    const filename = `affiliates_payout_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error) {
    log.error('Export affiliates CSV error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Export affiliate referrals CSV (detailed ledger)
const exportAffiliateReferralsCSV = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get affiliate info
    const affiliateResult = await db.query(
      `SELECT a.code, u.account_number
       FROM affiliates a
       JOIN users u ON a.user_id = u.id
       WHERE a.id = $1`,
      [id]
    );
    
    if (affiliateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Affiliate not found' });
    }
    
    const affiliate = affiliateResult.rows[0];
    
    // Get referrals for this affiliate
    const referralsResult = await db.query(
      `SELECT r.id, r.referred_user_id, r.status, r.commission_cents, r.paid_at, r.created_at,
              u.account_number as referred_account
       FROM referrals r
       JOIN users u ON r.referred_user_id = u.id
       WHERE r.affiliate_id = $1
       ORDER BY r.created_at DESC`,
      [id]
    );
    
    const csvHeader = 'Referral ID,Referred User ID,Referred Account,Status,Commission ($),Paid At,Created At\n';
    
    const csvRows = referralsResult.rows.map(row => {
      const commission = (row.commission_cents / 100).toFixed(2);
      const paidAt = row.paid_at ? new Date(row.paid_at).toISOString().split('T')[0] : '';
      const createdAt = new Date(row.created_at).toISOString().split('T')[0];
      const status = row.status;
      
      return `"${row.id}","${row.referred_user_id}","${row.referred_account}","${status}","${commission}","${paidAt}","${createdAt}"`;
    }).join('\n');

    const csvContent = csvHeader + csvRows;
    const filename = `affiliate_${affiliate.code}_referrals_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error) {
    log.error('Export affiliate referrals CSV error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get admin metrics endpoint (for management dashboard)
const getAdminMetrics = async (req, res) => {
  try {
    // Get summary stats
    const statsResult = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM affiliates) as total_affiliates,
        (SELECT COUNT(*) FROM affiliates WHERE status = 'active') as active_affiliates,
        (SELECT COUNT(*) FROM referrals WHERE status = 'active') as total_referred_customers,
        (SELECT SUM(amount_cents) FROM transactions WHERE type = 'commission' AND paid_out_at IS NOT NULL) as total_commissions_paid,
        (SELECT SUM(amount_cents) FROM transactions WHERE type = 'commission' AND paid_out_at IS NULL) as pending_payouts,
        (SELECT COUNT(*) FROM users) as total_customers,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'active') as active_subscriptions`
    );
    
    const stats = statsResult.rows[0];
    
    res.json({
      success: true,
      data: {
        totalAffiliates: parseInt(stats.total_affiliates) || 0,
        activeAffiliates: parseInt(stats.active_affiliates) || 0,
        totalReferredCustomers: parseInt(stats.total_referred_customers) || 0,
        totalCommissionsPaid: (parseInt(stats.total_commissions_paid) || 0) / 100,
        pendingPayouts: (parseInt(stats.pending_payouts) || 0) / 100,
        totalCustomers: parseInt(stats.total_customers) || 0,
        activeSubscriptions: parseInt(stats.active_subscriptions) || 0
      }
    });
  } catch (error) {
    log.error('Get admin metrics error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get referral tracking endpoint
const getReferralTracking = async (req, res) => {
  try {
    const { affiliateId, startDate, endDate, plan, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT r.id, r.created_at as signup_date, r.status, r.commission_cents, r.paid_at,
             p.name as plan_name, a.code as affiliate_code, u.account_number as affiliate_username,
             ru.account_number as customer_identifier
      FROM referrals r
      JOIN affiliates a ON r.affiliate_id = a.id
      JOIN users u ON a.user_id = u.id
      JOIN users ru ON r.referred_user_id = ru.id
      LEFT JOIN subscriptions s ON s.user_id = ru.id
      LEFT JOIN plans p ON s.plan_id = p.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (affiliateId) {
      query += ` AND r.affiliate_id = $${paramCount}`;
      params.push(affiliateId);
      paramCount++;
    }
    
    if (startDate) {
      query += ` AND r.created_at >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }
    
    if (endDate) {
      query += ` AND r.created_at <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }
    
    if (plan) {
      query += ` AND p.name ILIKE $${paramCount}`;
      params.push(`%${plan}%`);
      paramCount++;
    }
    
    query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);
    
    const referralsResult = await db.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM referrals r WHERE 1=1';
    const countParams = [];
    let countParamCount = 1;
    
    if (affiliateId) {
      countQuery += ` AND r.affiliate_id = $${countParamCount}`;
      countParams.push(affiliateId);
      countParamCount++;
    }
    
    if (startDate) {
      countQuery += ` AND r.created_at >= $${countParamCount}`;
      countParams.push(startDate);
      countParamCount++;
    }
    
    if (endDate) {
      countQuery += ` AND r.created_at <= $${countParamCount}`;
      countParams.push(endDate);
      countParamCount++;
    }
    
    const countResult = await db.query(countQuery, countParams);
    
    res.json({
      success: true,
      data: referralsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    log.error('Get referral tracking error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Log payout endpoint
const logPayout = async (req, res) => {
  try {
    const { affiliateUsername, amount, datePaid, notes } = req.body;
    
    if (!affiliateUsername || !amount) {
      return res.status(400).json({ error: 'Affiliate username and amount required' });
    }
    
    // Find affiliate by username
    const affiliateResult = await db.query(
      `SELECT a.id, a.username
       FROM affiliates a
       WHERE a.username = $1`,
      [affiliateUsername]
    );
    
    if (affiliateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Affiliate not found' });
    }
    
    const affiliate = affiliateResult.rows[0];
    const amountCents = Math.round(amount * 100);
    
    // Mark transactions as paid out
    await db.query(
      `UPDATE transactions
       SET paid_out_at = NOW()
       WHERE affiliate_id = $1 AND type = 'commission' AND paid_out_at IS NULL
       LIMIT 1`,
      [affiliate.id]
    );
    
    // Create payout request record
    const payoutResult = await db.query(
      `INSERT INTO payout_requests (affiliate_id, amount_cents, status, requested_at, processed_at, notes)
       VALUES ($1, $2, 'processed', $3, NOW(), $4)
       RETURNING id, amount_cents, status, processed_at, notes`,
      [affiliate.id, amountCents, datePaid || new Date(), notes || '']
    );
    
    // Log audit event
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, created_at, metadata)
       VALUES ('admin', $1, 'log_payout', 'affiliate', $2, NOW(), $3)`,
      [req.user.id, affiliate.id, JSON.stringify({ amount, datePaid, notes })]
    );
    
    res.json({
      success: true,
      data: payoutResult.rows[0],
      message: 'Payout logged successfully'
    });
  } catch (error) {
    log.error('Log payout error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get system settings endpoint
const getSystemSettings = async (req, res) => {
  try {
    const settingsResult = await db.query(
      'SELECT * FROM payout_config LIMIT 1'
    );
    
    const settings = settingsResult.rows[0] || {
      minimum_payout: 5000,
      commission_rate_monthly: 0.10,
      commission_rate_quarterly: 0.10,
      commission_rate_semiannual: 0.10,
      commission_rate_annual: 0.10,
      hold_period_days: 30
    };
    
    res.json({
      success: true,
      data: {
        minimumPayout: (settings.minimum_payout || 5000) / 100,
        commissionRates: {
          monthly: settings.commission_rate_monthly || 0.10,
          quarterly: settings.commission_rate_quarterly || 0.10,
          semiannual: settings.commission_rate_semiannual || 0.10,
          annual: settings.commission_rate_annual || 0.10
        },
        holdPeriodDays: settings.hold_period_days || 30
      }
    });
  } catch (error) {
    log.error('Get system settings error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update system settings endpoint
const updateSystemSettings = async (req, res) => {
  try {
    const { minimumPayout, commissionRates, holdPeriodDays } = req.body;
    
    // Update or insert settings
    await db.query(
      `INSERT INTO payout_config (minimum_payout, commission_rate_monthly, commission_rate_quarterly,
                                  commission_rate_semiannual, commission_rate_annual, hold_period_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         minimum_payout = EXCLUDED.minimum_payout,
         commission_rate_monthly = EXCLUDED.commission_rate_monthly,
         commission_rate_quarterly = EXCLUDED.commission_rate_quarterly,
         commission_rate_semiannual = EXCLUDED.commission_rate_semiannual,
         commission_rate_annual = EXCLUDED.commission_rate_annual,
         hold_period_days = EXCLUDED.hold_period_days`,
      [
        Math.round((minimumPayout || 50) * 100),
        commissionRates?.monthly || 0.10,
        commissionRates?.quarterly || 0.10,
        commissionRates?.semiannual || 0.10,
        commissionRates?.annual || 0.10,
        holdPeriodDays || 30
      ]
    );
    
    res.json({
      success: true,
      message: 'System settings updated successfully'
    });
  } catch (error) {
    log.error('Update system settings error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  login,
  logout,
  getCustomers,
  getCustomer,
  resetCustomerPassword,
  rotateCustomerRecoveryKit,
  rotateExternalAccessKey,
  sendMessageToCustomer,
  deactivateCustomer,
  deleteCustomer,
  createAffiliate,
  getAffiliates,
  getAffiliate,
  disableAffiliate,
  adjustAffiliateEarnings,
  getKPIs,
  exportAffiliatesCSV,
  exportAffiliateReferralsCSV,
  getAdminMetrics,
  getReferralTracking,
  logPayout,
  getSystemSettings,
  updateSystemSettings
};
