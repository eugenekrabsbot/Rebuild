import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

const getCookie = (name) => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
};

apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // Check all possible auth token locations: affiliate, admin, customer
    const token = localStorage.getItem('affiliateToken') || localStorage.getItem('adminToken') || localStorage.getItem('accessToken') || localStorage.getItem('authToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  const csrfToken = getCookie('csrfToken');
  if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    // 401 = auth failure: clear tokens and redirect to login
    if (status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('affiliateToken');
        localStorage.removeItem('adminToken');
        // Redirect to appropriate login page (React routes, not static HTML)
        const url = error.config?.url || '';
        if (url.includes('/affiliate/')) {
          window.location.href = '/affiliate';
        } else if (url.includes('/ahoyman/')) {
          window.location.href = '/ahoyman';
        } else {
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    }
    // 403 = CSRF failure: reject without retry to prevent infinite loops
    // (backend CSRF middleware handles affiliateId lookup now)
    if (status === 403) {
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);

// Generic GET/POST helpers for admin routes
const getAdmin = (path) => {
  // NOTE: Token priority must match the request interceptor below (line 21):
  // affiliateToken → adminToken → accessToken → authToken
  // For admin routes, we check adminToken first, then accessToken (customer token),
  // then authToken (legacy). affiliateToken is NOT used for admin routes.
  const token = localStorage.getItem('adminToken') || localStorage.getItem('accessToken') || localStorage.getItem('authToken');
  return apiClient.get(path, { headers: { Authorization: `Bearer ${token}` } });
};
const postAdmin = (path, data) => {
  const token = localStorage.getItem('adminToken') || localStorage.getItem('accessToken') || localStorage.getItem('authToken');
  return apiClient.post(path, data, { headers: { Authorization: `Bearer ${token}` } });
};

export const api = {
  // Generic admin GET/POST (uses adminToken)
  get: (path) => getAdmin(path),
  post: (path, data) => postAdmin(path, data),

  // ===== Affiliate Authentication =====
  affiliateLogin: async (username, password) => {
    const res = await apiClient.post('/auth/affiliate/login', { username, password });
    if (res.data?.data?.token) {
      localStorage.setItem('affiliateToken', res.data.data.token);
    }
    return res;
  },
  affiliateLogout: async () => {
    try { await apiClient.post('/auth/affiliate/logout'); } catch {}
    localStorage.removeItem('affiliateToken');
  },
  affiliateForgotPassword: async (username, recoveryCode) => {
    return apiClient.post('/auth/affiliate/forgot-password', { username, recoveryCode });
  },
  affiliateResetPassword: async (newPassword, confirmPassword, resetToken) => {
    return apiClient.post('/auth/affiliate/reset-password', { newPassword, confirmPassword }, {
      headers: { 'x-reset-token': resetToken },
    });
  },
  affiliateChangePassword: async (oldPassword, newPassword, confirmPassword) => {
    return apiClient.post('/auth/affiliate/change-password', { oldPassword, newPassword, confirmPassword });
  },
  affiliateGetProfile: async () => apiClient.get('/auth/affiliate/profile'),
  affiliateRegenerateKit: async (password) => {
    return apiClient.post('/auth/affiliate/regenerate-kit', { password });
  },

  // ===== AFFILIATE DASHBOARD =====
  getAffiliateMetrics: async () => apiClient.get('/affiliate/metrics'),
  getAffiliateLinks: async () => apiClient.get('/affiliate/links'),
  generateAffiliateLink: async () => apiClient.post('/affiliate/links'),
  createAffiliateLinkWithCode: async (code, discountCents = 0) => {
    // Create via affiliate links endpoint (generates link + optional discount)
    const discountType = discountCents > 0 ? 'fixed' : 'percent';
    const discountValue = discountCents > 0 ? discountCents : 0;
    return apiClient.post('/affiliate/codes', { code, discountType, discountValue, description: `Affiliate code ${code}` });
  },
  deleteAffiliateLink: async (id) => apiClient.delete(`/affiliate/codes/${id}`),
  getAffiliateReferrals: async (page = 1) => apiClient.get(`/affiliate/referrals?page=${page}&limit=20`),
  getAffiliateTransactions: async (page = 1) => apiClient.get(`/affiliate/transactions?page=${page}&limit=20`),
  getAffiliatePayoutRequests: async () => apiClient.get('/affiliate/payout-requests'),
  requestAffiliatePayout: async (amount) => apiClient.post('/affiliate/request-payout', { amount }),

  // ===== Admin / Ahoyman Authentication =====
  ahoymanLogin: async (username, password) => {
    const res = await apiClient.post('/auth/ahoyman/login', { username, password });
    if (res.data?.data?.token) {
      localStorage.setItem('adminToken', res.data.data.token);
    }
    return res;
  },
  ahoymanLogout: async () => {
    try { await apiClient.post('/auth/ahoyman/logout'); } catch {}
    localStorage.removeItem('adminToken');
  },
  adminMetrics: async () => apiClient.get('/auth/ahoyman/metrics'),

  // ===== ADMIN DASHBOARD =====
  getAffiliates: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiClient.get(`/auth/ahoyman/affiliates${qs ? '?' + qs : ''}`);
  },
  getAffiliate: async (id) => apiClient.get(`/auth/ahoyman/affiliates/${id}`),

  // ===== ADMIN CUSTOMERS =====
  getCustomers: async (page = 1, limit = 20) => getAdmin(`/admin/customers?page=${page}&limit=${limit}`),
  searchCustomer: async (query) => getAdmin(`/admin/customers/search?q=${encodeURIComponent(query)}`),

  // ===== ADMIN TAX =====
  // NOTE: These use apiClient.get() directly (not getAdmin) because the
  // Authorization header is injected by the request interceptor at the top
  // of this file. getAdmin() would also work but isn't needed here.
  getTaxTransactions: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiClient.get(`/auth/ahoyman/tax-transactions${qs ? '?' + qs : ''}`);
  },
  getTaxSummary: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiClient.get(`/auth/ahoyman/tax-transactions/summary${qs ? '?' + qs : ''}`);
  },
  // Nexus overview — per-state revenue and transaction count for economic nexus tracking
  // Economic nexus thresholds: $100k revenue OR 200 transactions per state (federal standard)
  getNexusOverview: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiClient.get(`/auth/ahoyman/nexus-overview${qs ? '?' + qs : ''}`);
  },

  // ===== ADMIN AFFILIATE MANAGEMENT =====
  createAffiliate: async (username, password) => postAdmin('/auth/ahoyman/affiliates', { username, password }),
  resetAffiliatePassword: async (id, password) => postAdmin(`/auth/ahoyman/affiliates/${id}/reset-password`, { password }),
  getAffiliate: async (id) => getAdmin(`/auth/ahoyman/affiliates/${id}`),
  suspendAffiliate: async (id) => apiClient.put(`/auth/ahoyman/affiliates/${id}/suspend`),
  reactivateAffiliate: async (id) => apiClient.put(`/auth/ahoyman/affiliates/${id}/reactivate`),
  regenerateAffiliateKit: async (id) => apiClient.post(`/auth/ahoyman/affiliates/${id}/regenerate-kit`),
  deleteAffiliate: async (id) => apiClient.delete(`/auth/ahoyman/affiliates/${id}`),
  archiveAffiliate: async (id) => apiClient.put(`/auth/ahoyman/affiliates/${id}/archive`),
  getAdminReferrals: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiClient.get(`/auth/ahoyman/referrals${qs ? '?' + qs : ''}`);
  },
  getPayoutRequests: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiClient.get(`/auth/ahoyman/payout-requests${qs ? '?' + qs : ''}`);
  },
  approvePayout: async (id, notes) => apiClient.put(`/auth/ahoyman/payout-requests/${id}/approve`, { notes }),
  rejectPayout: async (id, notes) => apiClient.put(`/auth/ahoyman/payout-requests/${id}/reject`, { notes }),
  logManualPayout: async (affiliateUsername, amount, notes) =>
    apiClient.post('/auth/ahoyman/payouts/manual', { affiliateUsername, amount, notes }),
  getSettings: async () => apiClient.get('/auth/ahoyman/settings'),
  updateSettings: async (data) => apiClient.put('/auth/ahoyman/settings', data),

  // ===== AFFILIATE CODES =====
  getAffiliateCodes: async () => apiClient.get('/auth/ahoyman/affiliate-codes'),
  createAffiliateCode: async (affiliateId, code, discountCents) => 
    apiClient.post('/auth/ahoyman/affiliate-codes', { affiliateId, code, discountCents }),
  updateAffiliateCodeDiscount: async (id, discountCents) =>
    apiClient.put(`/auth/ahoyman/affiliate-codes/${id}/discount`, { discountCents }),

  // ===== SALES TAX =====
  exportTaxCSV: async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiClient.get(`/auth/ahoyman/tax-transactions/export/csv${qs ? '?' + qs : ''}`, { responseType: 'blob' });
  },

  // ===== CUSTOMER AUTH (existing) =====
  register: async (password, confirmPassword) =>
    apiClient.post('/auth/register', { password, confirmPassword }),
  login: async (accountNumber, password) =>
    apiClient.post('/auth/login', { accountNumber, password }),
  recover: async (accountNumber, recoveryKit, newPassword) =>
    apiClient.post('/auth/customer/recovery/use-kit', { accountNumber, kit: recoveryKit, newPassword }),

  // ===== USER =====
  getUser: async () => apiClient.get('/me'),
  changePassword: async (oldPassword, newPassword) =>
    apiClient.put('/user/profile', { currentPassword: oldPassword, newPassword }),
  generateRecoveryKit: async (password) =>
    apiClient.post('/auth/customer/recovery/rotate-kit', { password }),

  // ===== SUBSCRIPTION =====
  getSubscription: async () => apiClient.get('/subscription'),
  upgradeDowngrade: async (newPlan) => apiClient.put('/subscription/switch', { planId: newPlan }),
  cancelSubscription: async () => apiClient.put('/subscription/cancel'),
  deleteAccount: async () => apiClient.delete('/user/account'),
  exportAccountData: async () => apiClient.post('/user/export'),
  downloadAccountExport: async (token) => apiClient.get(`/user/export/${token}`, { responseType: 'blob' }),

  // ===== CHECKOUT =====
  initiateCheckout: async (plan, paymentMethod, affiliateId = null, options = {}) => {
    const payload = { planId: plan, paymentMethod };
    if (affiliateId) payload.affiliateId = affiliateId;
    if (options.cryptoCurrency) payload.cryptoCurrency = options.cryptoCurrency;
    if (options.returnUrl) payload.returnUrl = options.returnUrl;
    if (options.cancelUrl) payload.cancelUrl = options.cancelUrl;
    if (options.country) payload.country = options.country;
    if (options.stateOrProvince) payload.stateOrProvince = options.stateOrProvince;
    if (options.postalCode) payload.postalCode = options.postalCode;
    return apiClient.post('/payment/checkout', payload);
  },
  confirmCheckoutSuccess: async (sessionId) =>
    apiClient.post('/payment/confirm', { sessionId }),
};

export default api;
