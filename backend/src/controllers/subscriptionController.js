const getPlans = async (req, res) => {
  try {
    const plans = [
      {
        id: 'monthly',
        name: 'Monthly',
        price: 9.99,
        period: '30 days',
        features: ['50+ countries', 'Unlimited bandwidth', 'OpenVPN & WireGuard', '5 device limit']
      },
      {
        id: 'quarterly',
        name: 'Quarterly',
        price: 24.99,
        period: '90 days',
        features: ['50+ countries', 'Unlimited bandwidth', 'OpenVPN & WireGuard', '5 device limit', 'Save 17%']
      },
      {
        id: 'semiAnnual',
        name: 'Semi-Annual',
        price: 44.99,
        period: '180 days',
        features: ['50+ countries', 'Unlimited bandwidth', 'OpenVPN & WireGuard', '5 device limit', 'Save 25%']
      },
      {
        id: 'annual',
        name: 'Annual',
        price: 79.99,
        period: '365 days',
        features: ['50+ countries', 'Unlimited bandwidth', 'OpenVPN & WireGuard', '5 device limit', 'Save 33%']
      }
    ];
    
    res.json({ success: true, data: plans });
  } catch (error) {
    log.error('Get plans error:', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

const userService = require('../services/userService');
const db = require('../config/database');

const log = require('../utils/logger');

const getSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    const subscription = await userService.getUserSubscription(userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    res.json({
      success: true,
      data: subscription
    });
  } catch (error) {
    log.error('Get subscription error:', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createSubscription = async (req, res) => {
  try {
    const { planKey, promoCode } = req.body;
    const userId = req.user.id;
    
    // Validate plan
    const validPlans = ['monthly', 'quarterly', 'semiAnnual', 'annual'];
    if (!validPlans.includes(planKey)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    // Get user email
    const userResult = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const email = userResult.rows[0].email;
    
    // Create subscription (trialing status - will be activated after payment)
    const subscription = await userService.createSubscription(userId, planKey, 0, 'trialing', null, null);
    
    res.json({
      success: true,
      data: subscription,
      message: 'Subscription created. Please complete payment to activate.'
    });
  } catch (error) {
    log.error('Create subscription error:', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

const pauseSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get current subscription
    const subscription = await userService.getUserSubscription(userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    // Check if already paused
    if (subscription.status === 'paused') {
      return res.status(400).json({ error: 'Subscription is already paused' });
    }
    
    // Update subscription status to paused
    const updateQuery = `
      UPDATE subscriptions 
      SET status = 'paused', pause_until = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;
    const pauseUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    const result = await db.query(updateQuery, [pauseUntil, subscription.id, userId]);
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Subscription paused for 30 days'
    });
  } catch (error) {
    log.error('Pause subscription error:', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

const resumeSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get current subscription
    const subscription = await userService.getUserSubscription(userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    // Check if already active
    if (subscription.status === 'active') {
      return res.status(400).json({ error: 'Subscription is already active' });
    }
    
    // Update subscription status to active
    const updateQuery = `
      UPDATE subscriptions 
      SET status = 'active', pause_until = NULL, updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    const result = await db.query(updateQuery, [subscription.id, userId]);
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Subscription resumed'
    });
  } catch (error) {
    log.error('Resume subscription error:', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get current subscription
    const subscription = await userService.getUserSubscription(userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    // Check if already cancelled
    if (subscription.status === 'cancelled') {
      return res.status(400).json({ error: 'Subscription is already cancelled' });
    }
    
    // Update subscription status to cancelled
    const updateQuery = `
      UPDATE subscriptions
      SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    const result = await db.query(updateQuery, [subscription.id, userId]);
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Subscription cancelled. You will retain access until the end of your billing period.'
    });
  } catch (error) {
    log.error('Cancel subscription error:', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

const switchPlan = async (req, res) => {
  try {
    const { newPlanKey } = req.body;
    const userId = req.user.id;
    
    // Validate new plan
    const validPlans = ['monthly', 'quarterly', 'semiAnnual', 'annual'];
    if (!validPlans.includes(newPlanKey)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    // Get current subscription
    const subscription = await userService.getUserSubscription(userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    // Check if already on this plan
    if (subscription.plan_key === newPlanKey) {
      return res.status(400).json({ error: 'Already on this plan' });
    }
    
    // Update subscription plan
    const updateQuery = `
      UPDATE subscriptions 
      SET plan_key = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;
    const result = await db.query(updateQuery, [newPlanKey, subscription.id, userId]);
    
    res.json({
      success: true,
      data: result.rows[0],
      message: `Plan switched to ${newPlanKey}`
    });
  } catch (error) {
    log.error('Switch plan error:', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's payment history
    const query = `
      SELECT p.*, s.plan_key, s.status as subscription_status
      FROM payments p
      JOIN subscriptions s ON p.subscription_id = s.id
      WHERE s.user_id = $1
      ORDER BY p.created_at DESC
    `;
    const result = await db.query(query, [userId]);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    log.error('Get invoices error:', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getPlans,
  getSubscription,
  createSubscription,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  switchPlan,
  getInvoices,
};