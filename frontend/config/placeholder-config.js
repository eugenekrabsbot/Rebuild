/**
 * AhoyVPN Frontend Placeholder Configuration
 *
 * Centralizes all hardcoded URLs, API endpoints, and payment processor URLs.
 * Each entry uses process.env with a fallback default and includes usage context.
 *
 * NOTE: Many of these should ideally come from an API at runtime rather than
 * being hardcoded. This file documents the current state for testing/replacement.
 */

// =============================================================================
// API & APPLICATION URLS
// =============================================================================

/**
 * Backend API base URL
 * Used in: api/client.js, throughout pages for fetch() calls to /api/*
 * WARNING: Should be fetched from API at runtime or environment-specific config
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

/**
 * Frontend application base URL
 * Used in: _document.jsx (canonical/OG tags), affiliate-dashboard.jsx (referral links),
 *          lib/seo.js, various pages for absolute URL construction
 * WARNING: Should be environment-specific (different for prod/staging/dev)
 */
export const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://ahoyvpn.net';

// =============================================================================
// PAYMENT PROCESSOR URLs
// =============================================================================

/**
 * Plisio (Cryptocurrency payments) checkout URL
 * Used in: _app.jsx (CSP header), pages/checkout.jsx (payment method docs)
 * WARNING: This is a third-party processor URL - verify it's current with Plisio docs
 */
export const PLISIO_CHECKOUT_URL = process.env.PLISIO_CHECKOUT_URL || 'https://checkout.plisio.net';

/**
 * Legacy card processor placeholders.
 * Kept only if we ever need to compare against old integrations during cleanup.
 */

// =============================================================================
// ROUTE CONSTANTS
// =============================================================================

/**
 * All frontend page routes - used for navigation and route guards
 * Used throughout: pages/*.jsx for Link hrefs and router.push() calls
 */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  CHECKOUT: '/checkout',
  DASHBOARD: '/dashboard',
  AFFILIATE: '/affiliate',
  AFFILIATE_DASHBOARD: '/affiliate-dashboard',
  AFFILIATE_AGREEMENT: '/affiliate-agreement',
  AHOYMAN: '/ahoyman',
  AHOYMAN_DASHBOARD: '/ahoyman-dashboard',
  ADMIN: '/admin',
  MANAGEMENT_DASHBOARD: '/management/dashboard',
  RECOVER: '/recover',
  DOWNLOADS: '/downloads',
  FAQ: '/faq',
  TOS: '/tos',
  PRIVACY: '/privacy',
  DNS_GUIDE: '/dns-guide',
  PAYMENT_SUCCESS: '/payment-success',
  AUTHORIZE_REDIRECT: '/authorize-redirect',
};

/**
 * Affiliate referral link base path
 * Used in: pages/affiliate-dashboard.jsx (generating referral URLs)
 */
export const AFFILIATE_LINK_PATH = '/affiliate';

/**
 * Legacy HTML page routes
 * These pages exist as index.html, checkout.html, dashboard.html, login.html
 * WARNING: Legacy - new pages use Next.js routing (e.g., /checkout not /checkout.html)
 */
export const LEGACY_HTML_ROUTES = {
  HOME_HTML: '/index.html',
  CHECKOUT_HTML: '/checkout.html',
  DASHBOARD_HTML: '/dashboard.html',
  LOGIN_HTML: '/login.html',
};

// =============================================================================
// PLAN PRICES (HARDCODED DEFAULTS)
// =============================================================================

/**
 * Default plan prices in USD
 * Used in: pages/checkout.jsx (display prices) as a fallback when API is unreachable
 * WARNING: These should ALWAYS come from the backend /api/subscription/plans endpoint.
 *          Hardcoded values are ONLY fallbacks for offline/error scenarios.
 *          Never use these for actual payment calculations - use API values.
 */
export const PLAN_PRICES = {
  monthly: {
    id: 'monthly',
    name: 'Monthly Plan',
    price: 5.99,
    period: '/month',
  },
  quarterly: {
    id: 'quarterly',
    name: 'Quarterly Plan',
    price: 16.99,
    period: '/3 months',
  },
  'semi-annual': {
    id: 'semi-annual',
    name: 'Semi-Annual Plan',
    price: 31.99,
    period: '/6 months',
    cryptoOnly: true,
  },
  annual: {
    id: 'annual',
    name: 'Annual Plan',
    price: 59.99,
    period: '/year',
    cryptoOnly: true,
  },
};

/**
 * Tax rate used for display calculations (8% estimated)
 * NOTE: This constant is not currently imported anywhere in the frontend codebase.
 *       Actual tax comes from ZipTax API via backend based on location.
 * WARNING: Do not use for actual payment calculations - use API values.
 */
export const DEFAULT_TAX_RATE = 0.08;

// =============================================================================
// PAYMENT METHODS
// =============================================================================

/**
 * Payment method providers
 * Used in: pages/checkout.jsx (PAYMENT_METHODS array)
 */
export const PAYMENT_PROVIDERS = {
  CRYPTO: 'Plisio',
  LEGACY_CARD: 'retired',
};

/**
 * Supported cryptocurrency options for Plisio
 * Used in: pages/checkout.jsx (CRYPTO_OPTIONS array)
 * WARNING: This is a subset - full list available from Plisio API
 */
export const SUPPORTED_CRYPTOCURRENCIES = [
  'BTC', 'ETH', 'USDC', 'USDT', 'LTC', 'DASH', 'ZEC', 'DOGE', 'BCH', 'XMR',
  'USDC_BEP20', 'USDT_TRX', 'USDT_BEP20', 'TON', 'APE', 'SOL', 'LOVE', 'ETH',
  'BASE_ETH', 'ETC', 'BTTC_TRX', 'BUSD_BEP20', 'BNB', 'TRX', 'SHIB',
];

// =============================================================================
// AUTHENTICATION & REFERRAL
// =============================================================================

/**
 * Affiliate cookie name
 * Used in: lib/cookies.js (getAffiliateId/removeAffiliateId)
 */
export const AFFILIATE_COOKIE_NAME = 'ahoy_affiliate';

/**
 * Default affiliate attribution parameter name in URL
 * Used in: pages/affiliate/[code].jsx, lib/cookies.js
 */
export const AFFILIATE_PARAM = 'ref';

/**
 * CSRF cookie name
 * NOTE: This constant is not currently imported anywhere in the frontend codebase.
 */
export const CSRF_COOKIE_NAME = 'csrfToken';

// =============================================================================
// SUPPORT CONTACT
// =============================================================================

/**
 * Support email address
 * Used throughout: Layout.jsx, tos.jsx, privacy.jsx, faq.jsx, affiliate-*.jsx,
 *                  ahoyman-dashboard.jsx, register.jsx, downloads.jsx, dns-guide.jsx
 * WARNING: Should come from backend settings API in production
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'ahoyvpn@ahoyvpn.net';
