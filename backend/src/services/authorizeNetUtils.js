// Shared Authorize.net utility functions
// Kept separate to avoid circular dependency between paymentController and webhookController
//
// NOTE: A duplicate AuthorizeNetService class previously existed inline in paymentController.js.
// This canonical class now contains ALL shared methods. The duplicate has been removed.

const AUTHORIZE_API_URL = process.env.AUTHORIZE_NET_API_URL || 'https://api.authorize.net/xml/v1/request.api';
const log = require('../utils/logger');

/**
 * Look up full transaction details from Authorize.net by transaction ID.
 * Returns the parsed transaction data or null on failure.
 */
async function getAuthorizeTransactionDetails(transactionId) {
  try {
    const apiLoginId = process.env.AUTHORIZE_NET_API_LOGIN_ID;
    const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;

    if (!transactionId || !apiLoginId || !transactionKey) {
      return null;
    }

    const requestBody = {
      getTransactionDetailsRequest: {
        merchantAuthentication: {
          name: apiLoginId,
          transactionKey
        },
        transId: String(transactionId)
      }
    };

    const response = await fetch(AUTHORIZE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      return null;
    }

    const raw = await response.text();
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));

    if (data?.messages?.resultCode !== 'Ok') {
      return null;
    }

    const tx = data?.transaction || {};
    const order = tx?.order || {};

    let responseCode = String(tx?.responseCode || tx?.transactionResponse?.responseCode || '').trim();
    const transactionStatus = String(tx?.transactionStatus || '').trim();

    if (!responseCode && ['capturedPendingSettlement', 'settledSuccessfully', 'authorizedPendingCapture'].includes(transactionStatus)) {
      responseCode = '1';
    }

    return {
      invoiceNumber: String(order?.invoiceNumber || order?.invoice_number || '').trim(),
      responseCode,
      amountRaw: tx?.authAmount || tx?.settleAmount || null,
      transactionStatus,
      customerProfileId: String(tx?.profile?.customerProfileId || '').trim() || null,
      customerPaymentProfileId: String(tx?.profile?.customerPaymentProfileId || '').trim() || null
    };
  } catch (error) {
    log.error('Authorize transaction details lookup failed', { error: error.message || error });
    return null;
  }
}

async function cancelArbSubscription(subscriptionId) {
  if (!subscriptionId) return { success: false, message: 'No ARB subscription ID provided' };

  const apiLoginId = process.env.AUTHORIZE_NET_API_LOGIN_ID;
  const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;

  if (!apiLoginId || !transactionKey) {
    throw new Error('Authorize.net credentials are missing');
  }

  const requestBody = {
    ARBCancelSubscriptionRequest: {
      merchantAuthentication: {
        name: apiLoginId,
        transactionKey
      },
      subscriptionId: String(subscriptionId)
    }
  };

  try {
    const response = await fetch(AUTHORIZE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const raw = await response.text();
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));

    if (data?.messages?.resultCode === 'Ok') {
      return { success: true, subscriptionId };
    }

    const msg = data?.messages?.message?.[0]?.text || 'ARB cancellation failed';
    return { success: false, message: msg };
  } catch (error) {
    log.error('ARB cancellation error', { error: error.message || error });
    throw error;
  }
}

class AuthorizeNetService {
  constructor() {
    this.apiLoginId = process.env.AUTHORIZE_NET_API_LOGIN_ID;
    this.transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;
  }

  async _makeRequest(requestBody) {
    if (!this.apiLoginId || !this.transactionKey) {
      throw new Error('Authorize.net credentials are not configured');
    }

    const response = await fetch(AUTHORIZE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        merchantAuthentication: {
          name: this.apiLoginId,
          transactionKey: this.transactionKey
        }
      })
    });

    const raw = await response.text();
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  }

  async getArbSubscription(subscriptionId) {
    try {
      const data = await this._makeRequest({
        ARBGetSubscriptionRequest: {
          subscriptionId: String(subscriptionId)
        }
      });

      if (data?.messages?.resultCode !== 'Ok') {
        return null;
      }

      const sub = data?.subscription || {};
      return {
        id: subscriptionId,
        name: sub?.name || '',
        status: sub?.status || 'unknown',
        currentBillAmount: sub?.currentBillAmount || sub?.lastPaymentAmount || '0.00',
        lastPaymentAmount: sub?.lastPaymentAmount || '0.00',
        lastPaymentDate: sub?.lastPaymentDate || null,
        nextBillingDate: sub?.nextBillingDate || null,
        currentPeriodEnd: sub?.nextBillingDate || null,
        createdDate: sub?.createTimeStamp || null,
        firstRenewalDate: sub?.firstRenewalDate || null,
        lastPaymentId: null
      };
    } catch (error) {
      log.error('ARB subscription lookup error', { error: error.message || error });
      return null;
    }
  }

  async getTransactionDetails(transactionId) {
    try {
      const data = await this._makeRequest({
        getTransactionDetailsRequest: {
          transId: String(transactionId)
        }
      });

      if (data?.messages?.resultCode !== 'Ok') {
        return null;
      }

      const tx = data?.transaction || {};
      return {
        transactionId: String(transactionId),
        transactionStatus: tx?.transactionStatus || '',
        amount: tx?.authAmount || tx?.settleAmount || null,
        responseCode: tx?.responseCode || ''
      };
    } catch (error) {
      log.error('Transaction details lookup error', { error: error.message || error });
      return null;
    }
  }

  async cancelSubscription(subscriptionId) {
    return cancelArbSubscription(subscriptionId);
  }

  // ─── Methods previously duplicated inline in paymentController.js ──────────

  /**
   * Returns the Authorize.net XML API endpoint URL.
   * Used by createTransaction, createHostedPaymentPage, createArbSubscription, etc.
   * Note: This was previously mistakenly referenced as paymentConfig.authorizeNet.endpoints.charge
   * which was never imported — this method now correctly returns the AUTHORIZE_API_URL constant.
   */
  getApiEndpoint() {
    return AUTHORIZE_API_URL;
  }

  /**
   * Returns the hosted payment form URL for the current environment.
   */
  getHostedFormUrl() {
    return this.environment === 'production'
      ? 'https://accept.authorize.net/payment/payment'
      : 'https://test.authorize.net/payment/payment';
  }

  /**
   * Create a hosted payment page token for the embedded Accept.js flow.
   * Returns { token, formUrl } where token is passed to Accept.js to render the form.
   */
  async createHostedPaymentPage({ amount, invoiceNumber, description, returnUrl, cancelUrl, email }) {
    if (!this.apiLoginId || !this.transactionKey) {
      throw new Error('Authorize.net credentials are missing');
    }

    const requestBody = {
      getHostedPaymentPageRequest: {
        merchantAuthentication: {
          name: this.apiLoginId,
          transactionKey: this.transactionKey
        },
        transactionRequest: {
          transactionType: 'authCaptureTransaction',
          amount: amount.toString(),
          order: { invoiceNumber, description },
          customer: { email }
        },
        hostedPaymentSettings: {
          setting: [
            {
              settingName: 'hostedPaymentReturnOptions',
              settingValue: JSON.stringify({
                showReceipt: true,
                url: returnUrl,
                urlText: 'Return to AhoyVPN',
                cancelUrl,
                cancelUrlText: 'Cancel'
              })
            },
            {
              settingName: 'hostedPaymentButtonOptions',
              settingValue: JSON.stringify({ text: 'Pay' })
            }
          ]
        }
      }
    };

    const response = await fetch(this.getApiEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Authorize.net hosted page API error: ${response.status}`);
    }

    // Authorize.net sometimes prepends a UTF-8 BOM or whitespace before JSON.
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (err) {
      log.error('Authorize.net hosted page JSON parse error', { error: err.message, body: raw.slice(0, 200) });
      throw new Error('Authorize.net hosted page returned invalid JSON');
    }

    const resultCode = data?.messages?.resultCode;

    if (process.env.DEBUG_AUTHORIZE_NET === 'true') {
      log.debug('Authorize.net hosted response', {
        resultCode,
        token: data?.token || null,
        messages: data?.messages || null
      });
    }

    if (resultCode !== 'Ok' || !data?.token) {
      const msg = data?.messages?.message?.[0]?.text || 'Failed to create hosted payment token';
      throw new Error(msg);
    }

    return {
      token: data.token,
      formUrl: this.getHostedFormUrl()
    };
  }

  /**
   * Legacy direct-card transaction (authOnly).
   * Note: Direct card collection is deprecated in favor of hosted payment page.
   * Kept for backward compatibility with any existing flows.
   */
  async createTransaction(amount, cardData, billingInfo) {
    const transactionRequest = {
      createTransactionRequest: {
        merchantAuthentication: {
          name: this.apiLoginId,
          transactionKey: this.transactionKey
        },
        transactionRequest: {
          transactionType: 'authOnlyTransaction',
          amount: amount.toString(),
          payment: {
            creditCard: {
              cardNumber: cardData.number,
              expirationDate: cardData.expiration,
              cardCode: cardData.cvv
            }
          },
          billTo: {
            firstName: billingInfo.firstName,
            lastName: billingInfo.lastName,
            address: billingInfo.address,
            city: billingInfo.city,
            state: billingInfo.state,
            zip: billingInfo.zip,
            country: billingInfo.country
          }
        }
      }
    };

    try {
      const response = await fetch(this.getApiEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transactionRequest)
      });

      if (!response.ok) {
        throw new Error(`Authorize.net API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      log.error('Authorize.net API error', { error: error });
      throw error;
    }
  }

  /**
   * Create a new Authorize.net ARB subscription using card data.
   * intervalUnit: 'days' | 'months', startDate: 'YYYY-MM-DD'
   */
  async createArbSubscription({
    amount,
    intervalLength,
    intervalUnit,
    startDate,
    subscriberName,
    subscriberEmail,
    billingAddress,
    invoiceNumber,
    description
  }) {
    const requestBody = {
      createSubscriptionRequest: {
        merchantAuthentication: {
          name: this.apiLoginId,
          transactionKey: this.transactionKey
        },
        subscription: {
          name: description || 'AhoyVPN Subscription',
          paymentSchedule: {
            startDate,
            interval: { length: intervalLength, unit: intervalUnit },
            totalOccurrences: 9999,
            trialOccurrences: 0
          },
          amount: parseFloat(amount).toFixed(2),
          payment: {
            creditCard: {
              cardNumber: billingAddress.cardNumber,
              expirationDate: billingAddress.expirationDate,
              cardCode: billingAddress.cardCode
            }
          },
          customer: { email: subscriberEmail },
          billTo: {
            firstName: billingAddress.firstName || subscriberName?.split(' ')[0] || '',
            lastName: billingAddress.lastName || subscriberName?.split(' ').slice(1).join(' ') || '',
            address: billingAddress.address || '',
            city: billingAddress.city || '',
            state: billingAddress.state || '',
            zip: billingAddress.zip || '',
            country: billingAddress.country || 'USA'
          },
          order: { invoiceNumber, description }
        }
      }
    };

    try {
      const response = await fetch(this.getApiEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const raw = await response.text();
      const result = JSON.parse(raw.replace(/^\uFEFF/, ''));

      if (result?.messages?.resultCode !== 'Ok') {
        const msg = result?.messages?.message?.[0]?.text || 'ARB subscription creation failed';
        throw new Error(msg);
      }

      return {
        subscriptionId: result.subscriptionId,
        status: result.messages?.resultCode
      };
    } catch (error) {
      log.error('ARB subscription creation error', { error: error.message || error });
      throw error;
    }
  }

  /**
   * Create an ARB subscription using an already-stored customer payment profile.
   * Used after a hosted payment page charge where Authorize.net automatically
   * stores the card as a payment profile.
   */
  async createArbSubscriptionFromProfile({
    amount,
    intervalLength,
    intervalUnit,
    startDate,
    customerProfileId,
    customerPaymentProfileId,
    subscriberEmail,
    description,
    invoiceNumber
  }) {
    const requestBody = {
      createSubscriptionRequest: {
        merchantAuthentication: {
          name: this.apiLoginId,
          transactionKey: this.transactionKey
        },
        subscription: {
          name: description || 'AhoyVPN Subscription',
          paymentSchedule: {
            startDate,
            interval: { length: intervalLength, unit: intervalUnit },
            totalOccurrences: 9999,
            trialOccurrences: 0
          },
          amount: parseFloat(amount).toFixed(2),
          payment: { storedCredentials: { mandate: 'recurring' } },
          customer: { email: subscriberEmail },
          order: { invoiceNumber: `ARB-${invoiceNumber}`, description },
          customerProfileId: String(customerProfileId),
          customerPaymentProfileId: String(customerPaymentProfileId)
        }
      }
    };

    try {
      const response = await fetch(this.getApiEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const raw = await response.text();
      const result = JSON.parse(raw.replace(/^\uFEFF/, ''));

      if (result?.messages?.resultCode !== 'Ok') {
        const msg = result?.messages?.message?.[0]?.text || 'ARB subscription from profile failed';
        throw new Error(msg);
      }

      return {
        subscriptionId: result.subscriptionId,
        status: result.messages?.resultCode
      };
    } catch (error) {
      log.error('ARB subscription from profile error', { error: error.message || error });
      throw error;
    }
  }

  /**
   * Get a hosted Accept Customer profile page token.
   * Used when a customer wants to update their stored card.
   * POSTs to https://accept.authorize.net/customer/editPayment with the returned token.
   *
   * @param {string} customerProfileId - Authorize.net customer profile ID
   * @param {object} options
   * @param {string} options.returnUrl - URL to return to after update
   * @param {string} options.iframeCommunicatorUrl - Optional iframe communicator URL
   */
  async getHostedProfilePageRequest(customerProfileId, {
    returnUrl = 'https://ahoyvpn.net/dashboard',
    iframeCommunicatorUrl = null
  } = {}) {
    const hostedPaymentSettings = [
      {
        settingName: 'hostedProfileReturnUrl',
        settingValue: returnUrl
      },
      {
        settingName: 'hostedProfileReturnUrlText',
        settingValue: 'Return to AhoyVPN'
      },
      {
        settingName: 'hostedProfilePageBorderVisible',
        settingValue: 'true'
      }
    ];

    if (iframeCommunicatorUrl) {
      hostedPaymentSettings.push({
        settingName: 'hostedProfileIFrameCommunicatorUrl',
        settingValue: iframeCommunicatorUrl
      });
    }

    const requestBody = {
      getHostedProfilePageRequest: {
        merchantAuthentication: {
          name: this.apiLoginId,
          transactionKey: this.transactionKey
        },
        customerProfileId: String(customerProfileId),
        hostedProfileSettings: {
          setting: hostedPaymentSettings
        }
      }
    };

    try {
      const response = await fetch(this.getApiEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const raw = await response.text();
      const data = JSON.parse(raw.replace(/^\uFEFF/, ''));

      if (data?.messages?.resultCode !== 'Ok' || !data?.token) {
        const msg = data?.messages?.message?.[0]?.text || 'Failed to create hosted profile page token';
        throw new Error(msg);
      }

      return {
        token: data.token,
        formUrl: this.getHostedFormUrl().replace('/payment/payment', '/customer/editPayment')
      };
    } catch (error) {
      log.error('getHostedProfilePageRequest error', { error: error.message });
      throw error;
    }
  }

  /**
   * Get customer profile IDs (customerProfileId + customerPaymentProfileId)
   * from an existing ARB subscription.
   * Authorize.net's ARBGetSubscriptionResponse includes the payment profile IDs.
   */
  async getArbSubscriptionProfileIds(subscriptionId) {
    try {
      const data = await this._makeRequest({
        ARBGetSubscriptionRequest: {
          subscriptionId: String(subscriptionId)
        }
      });

      if (data?.messages?.resultCode !== 'Ok') {
        return null;
      }

      const sub = data?.subscription || {};
      return {
        customerProfileId: String(sub?.profile?.customerProfileId || '').trim() || null,
        customerPaymentProfileId: String(sub?.profile?.customerPaymentProfileId || '').trim() || null
      };
    } catch (error) {
      log.error('getArbSubscriptionProfileIds error', { error: error.message });
      return null;
    }
  }
} = { getAuthorizeTransactionDetails, cancelArbSubscription, AuthorizeNetService, parseHostedPaymentPageResponse };

/**
 * Parse a hosted payment page callback payload (POST from Authorize.net relay).
 * Handles two cases:
 *  - Standard relay POST: has x_response_code, x_trans_id, x_invoice_num directly
 *  - Accept.js token response: has x_payload (opaque descriptor token)
 * Returns null if the payload can't be parsed.
 *
 * @param {object} payload - req.body from the relay POST
 * @param {string} relayUrl - The relay URL (used to POST the opaque data back to Authorize.net)
 * @returns {Promise<object|null>} Parsed fields: { transId, invoiceNumber, amount, responseCode, responseReasonText, cardType, email }
 */
async function parseHostedPaymentPageResponse(payload, relayUrl) {
  const responseCode = String(payload.x_response_code || payload.response_code || '').trim();

  const transId = String(payload.x_trans_id || payload.transId || '').trim();
  const invoiceNumber = String(payload.x_invoice_num || payload.invoiceNumber || '').trim();
  const amountRaw = String(payload.x_amount || payload.amount || '').trim();

  // If we have a direct response, return it directly
  if (responseCode || transId) {
    return {
      transId,
      invoiceNumber,
      amount: amountRaw,
      responseCode,
      responseReasonText: String(payload.x_response_reason_text || payload.response_reason_text || '').trim(),
      cardType: String(payload.x_card_type || payload.card_type || '').trim(),
      email: String(payload.x_email || payload.email || '').trim()
    };
  }

  // Accept.js token mode: x_payload is a base64-encoded JSON blob
  const xPayload = payload.x_payload || payload.payload || '';
  if (!xPayload) {
    return null;
  }

  try {
    // Decode the opaque data token by POSTing it back to Authorize.net's getTransactionDetails
    const decoded = await AuthorizeNetService.getAuthorizeTransactionDetails(xPayload);
    if (!decoded) return null;

    return {
      transId: decoded.transId || '',
      invoiceNumber: decoded.invoiceNumber || decoded.invoice_number || '',
      amount: decoded.amount || '',
      responseCode: decoded.responseCode || decoded.status || '',
      responseReasonText: decoded.responseReasonText || '',
      cardType: decoded.cardType || decoded.card_type || '',
      email: decoded.email || ''
    };
  } catch (err) {
    log.warn('Failed to parse hosted payment page response', { error: err.message });
    return null;
  }
}
  /**
   * Get a hosted Accept Customer profile page token.
   * Used when a customer wants to update their stored card.
   * POSTs to https://accept.authorize.net/customer/editPayment with the returned token.
   *
   * @param {string} customerProfileId - Authorize.net customer profile ID
   * @param {object} options
   * @param {string} options.returnUrl - URL to return to after update
   * @param {string} options.iframeCommunicatorUrl - Optional iframe communicator URL
   */
  async getHostedProfilePageRequest(customerProfileId, {
    returnUrl = 'https://ahoyvpn.net/dashboard',
    iframeCommunicatorUrl = null
  } = {}) {
    const hostedPaymentSettings = [
      {
        settingName: 'hostedProfileReturnUrl',
        settingValue: returnUrl
      },
      {
        settingName: 'hostedProfileReturnUrlText',
        settingValue: 'Return to AhoyVPN'
      },
      {
        settingName: 'hostedProfilePageBorderVisible',
        settingValue: 'true'
      }
    ];

    if (iframeCommunicatorUrl) {
      hostedPaymentSettings.push({
        settingName: 'hostedProfileIFrameCommunicatorUrl',
        settingValue: iframeCommunicatorUrl
      });
    }

    const requestBody = {
      getHostedProfilePageRequest: {
        merchantAuthentication: {
          name: this.apiLoginId,
          transactionKey: this.transactionKey
        },
        customerProfileId: String(customerProfileId),
        hostedProfileSettings: {
          setting: hostedPaymentSettings
        }
      }
    };

    try {
      const response = await fetch(this.getApiEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const raw = await response.text();
      const data = JSON.parse(raw.replace(/^\uFEFF/, ''));

      if (data?.messages?.resultCode !== 'Ok' || !data?.token) {
        const msg = data?.messages?.message?.[0]?.text || 'Failed to create hosted profile page token';
        throw new Error(msg);
      }

      return {
        token: data.token,
        formUrl: this.getHostedFormUrl().replace('/payment/payment', '/customer/editPayment')
      };
    } catch (error) {
      log.error('getHostedProfilePageRequest error', { error: error.message });
      throw error;
    }
  }

  /**
   * Get customer profile IDs (customerProfileId + customerPaymentProfileId)
   * from an existing ARB subscription.
   * Authorize.net's ARBGetSubscriptionResponse includes the payment profile IDs.
   */
  async getArbSubscriptionProfileIds(subscriptionId) {
    try {
      const data = await this._makeRequest({
        ARBGetSubscriptionRequest: {
          subscriptionId: String(subscriptionId)
        }
      });

      if (data?.messages?.resultCode !== 'Ok') {
        return null;
      }

      const sub = data?.subscription || {};
      return {
        customerProfileId: String(sub?.profile?.customerProfileId || '').trim() || null,
        customerPaymentProfileId: String(sub?.profile?.customerPaymentProfileId || '').trim() || null
      };
    } catch (error) {
      log.error('getArbSubscriptionProfileIds error', { error: error.message });
      return null;
    }
  }
}
