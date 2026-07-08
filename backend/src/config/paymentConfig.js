// Update payment configuration to use VPN Resellers and Authorize.net

const paymentConfig = {
  // VPN Resellers Configuration
  vpnResellers: {
    // Re-read from env each call — process.env is always correct at runtime because
    // dotenv.config() populates it before any module that imports paymentConfig runs.
    apiToken: process.env.VPN_RESELLERS_API_TOKEN,
    // Fallback: if not in env, use the evaluated value at import time (works when
    // dotenv runs before this module is imported, which is the case in index.js).
    // Access pattern: (process.env.VPN_RESELLERS_API_TOKEN || paymentConfig._fallbackToken)
    _fallbackToken: process.env.VPN_RESELLERS_API_TOKEN,
    apiUrl: 'https://api.vpnresellers.com',
    planIds: {
      month: process.env.VPN_RESELLERS_PLAN_MONTHLY_ID,
      quarter: process.env.VPN_RESELLERS_PLAN_QUARTERLY_ID,
      semi_annual: process.env.VPN_RESELLERS_PLAN_SEMIANNUAL_ID,
      year: process.env.VPN_RESELLERS_PLAN_ANNUAL_ID
    },
    endpoints: {
      checkUsername: '/v3_2/accounts/check_username',
      createAccount: '/v3_2/accounts',
      enableAccount: '/v3_2/accounts/{accountId}/enable',
      disableAccount: '/v3_2/accounts/{accountId}/disable',
      changePassword: '/v3_2/accounts/{accountId}/change_password',
      expireAccount: '/v3_2/accounts/{accountId}/expire',
      getAccount: '/v3_2/accounts/{accountId}'
    }
  },

  // Plisio Configuration (already exists)
  plisios: {
    apiKey: process.env.PLISIO_API_KEY,
    apiUrl: 'https://plisio.net/api/v1'
  }
};

module.exports = paymentConfig;
