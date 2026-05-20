/**
 * vpnResellersService — Interface to the VPN Resellers API (v3_2).
 *
 * WHY THIS SERVICE EXISTS:
 * VPN Resellers is the backend infrastructure provider that provisions actual
 * VPN accounts (WireGuard/OpenVPN credentials) when customers pay. We call
 * their API to create accounts, set expiry dates, enable/disable access, and
 * retrieve live credentials for config file generation.
 *
 * VPN PROVIDER IDENTITY CRISIS:
 * The DB column is named `vpnresellers_*` but the actual provider is VPN Resellers.
 * 
 * Both providers may be used or consolidated in the future.
 *
 * ABOUT node-fetch:
 * Node 22 has native global fetch — we use it directly here instead of requiring
 * the node-fetch npm package. This keeps dependencies lean. If Node version drops
 * below 18, we'd need to add node-fetch back as a dependency.
 */
const paymentConfig = require('../config/paymentConfig');

class VpnResellersService {
  constructor() {
    // VPN_RESELLERS_API_TOKEN is loaded from .env at module initialization time.
    // dotenv.config({path}) must run BEFORE this module is imported — index.js does
    // this at the top, but since paymentConfig reads process.env at import time (before
    // dotenv runs), we re-read the token here at access time as a safety net.
    this._apiToken = paymentConfig.vpnResellers.apiToken;
    this.baseUrl = paymentConfig.vpnResellers.apiUrl;
    this.endpoints = paymentConfig.vpnResellers.endpoints;
  }

  _getToken() {
    // Re-read from env each call so the service works regardless of whether
    // dotenv.config() ran before or after this module was imported.
    return this._apiToken || process.env.VPN_RESELLERS_API_TOKEN || paymentConfig.vpnResellers.apiToken;
  }

  /**
   * _request — Low-level HTTP dispatcher for all VPN Resellers API calls.
   *
   * WHY A PRIVATE METHOD:
   * Every API operation follows the same pattern: build URL, set auth headers,
   * make the request, handle errors, return parsed JSON. Encapsulating this in
   * _request() lets each public method focus purely on its own business logic
   * (payload shape, endpoint path, HTTP method). If the HTTP library or auth
   * scheme changes, only this method needs updating.
   *
   * @param {string} path - API path appended to baseUrl (e.g. '/accounts/create')
   * @param {object} options - method (GET|PUT|POST), body (object to JSON-encode)
   * @returns {Promise<object>} Parsed JSON response body
   * @throws {Error} VPN Resellers API error with status code and raw body attached
   */
  async _request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const method = options.method || (options.body ? 'POST' : 'GET');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this._getToken()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers
      },
      method,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      // Capture the raw error body so operators can see exactly what the
      // upstream API returned without having to reproduce the call manually.
      const text = await response.text();
      const err = new Error(`VPN Resellers API error: ${response.status}: ${text}`);
      err.status = response.status;
      err.body = text;
      throw err;
    }

    return response.json();
  }

  async checkUsername(username) {
    const path = `${this.endpoints.checkUsername}?username=${encodeURIComponent(username)}`;
    return this._request(path, { method: 'GET' });
  }

  async createAccount(payload) {
    return this._request(this.endpoints.createAccount, { method: 'POST', body: payload });
  }

  async enableAccount(accountId) {
    const path = this.endpoints.enableAccount.replace('{accountId}', encodeURIComponent(accountId));
    return this._request(path, { method: 'PUT' });
  }

  async disableAccount(accountId) {
    const path = this.endpoints.disableAccount.replace('{accountId}', encodeURIComponent(accountId));
    return this._request(path, { method: 'PUT' });
  }

  async changePassword(accountId, password) {
    const path = this.endpoints.changePassword.replace('{accountId}', encodeURIComponent(accountId));
    return this._request(path, { method: 'PUT', body: { password } });
  }

  async setExpiry(accountId, expireAt) {
    const path = this.endpoints.expireAccount.replace('{accountId}', encodeURIComponent(accountId));
    return this._request(path, { method: 'PUT', body: { expire_at: expireAt } });
  }

  async getAccount(accountId) {
    const path = this.endpoints.getAccount.replace('{accountId}', encodeURIComponent(accountId));
    return this._request(path, { method: 'GET' });
  }
}

module.exports = VpnResellersService;
