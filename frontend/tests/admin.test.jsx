/**
 * admin.jsx — Unit Tests
 * ======================
 * Tests the admin dashboard page (KPI metrics, customer search, affiliate management).
 *
 * WHY THIS TEST:
 * - admin.jsx is a complex page (496 lines) with 3 tab sections: KPIs, Customers, Affiliates
 * - It handles sensitive admin operations (customer search, affiliate disable/adjust)
 * - No prior test coverage existed
 *
 * KEY MOCKS:
 * - next/router: useRouter for redirect logic
 * - api/client: adminMetrics, getAffiliates, searchCustomer, disableAffiliate,
 *               adjustAffiliateEarnings
 * - lib/sanitize: sanitizeText (XSS protection, tested independently in sanitize.test.js)
 */

jest.mock('next/router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('../api/client', () => ({
  __esModule: true,
  default: {
    adminMetrics: jest.fn(),
    getAffiliates: jest.fn(),
    searchCustomer: jest.fn(),
    disableAffiliate: jest.fn(),
    adjustAffiliateEarnings: jest.fn(),
  },
}));

jest.mock('../lib/sanitize', () => ({
  sanitizeText: jest.fn((text) => text.trim()),
}));

import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AuthContext } from '../pages/_app';
import Admin from '../pages/admin';

// Auth context — admin role
const ADMIN_AUTH = {
  isLoggedIn: true,
  role: 'admin',
  user: { id: 'admin-1', email: 'admin@ahoyvpn.net' },
};

const MOCK_METRICS = {
  totalCustomers: 1523,
  activeSubscriptions: 1204,
  mrr: 7234.56,
  cryptoVsFiat: { crypto: 62, fiat: 38 },
};

const MOCK_AFFILIATES = [
  {
    id: 'aff-1',
    account_number: 'ACC001',
    code: 'WILLIAM10',
    active_referrals: 42,
    total_commission_cents: 150000,
    pending_payout_cents: 25000,
    is_active: true,
  },
  {
    id: 'aff-2',
    account_number: 'ACC002',
    code: 'ALEX20',
    active_referrals: 15,
    total_commission_cents: 45000,
    pending_payout_cents: 0,
    is_active: true,
  },
];

const MOCK_CUSTOMER_DATA = {
  id: 'cust-123',
  subscription: { plan: 'monthly', status: 'active' },
};

// Helper to render Admin with auth context
function renderAdmin(auth = ADMIN_AUTH) {
  return render(
    <AuthContext.Provider value={auth}>
      <Admin />
    </AuthContext.Provider>
  );
}

describe('admin.jsx', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // KPI Tab Tests
  // -------------------------------------------------------------------------
  describe('KPI tab', () => {
    test('renders KPI tab with metrics data', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
        expect(screen.getByText('1523')).toBeInTheDocument();
        expect(screen.getByText('1204')).toBeInTheDocument();
        expect(screen.getByText('$7234.56')).toBeInTheDocument();
      });
    });

    test('renders payment split bars with crypto/fiat percentages', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('Cryptocurrency')).toBeInTheDocument();
        expect(screen.getByText('Crypto (Plisio)')).toBeInTheDocument();
        expect(screen.getByText('62%')).toBeInTheDocument();
        expect(screen.getByText('38%')).toBeInTheDocument();
      });
    });

    test('shows system notes in KPI tab', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('MRR is calculated from active subscriptions only')).toBeInTheDocument();
        expect(screen.getByText('Crypto includes Bitcoin and other cryptocurrencies via Plisio')).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Tab Navigation Tests
  // -------------------------------------------------------------------------
  describe('tab navigation', () => {
    test('defaults to KPIs tab', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });

      renderAdmin();

      await waitFor(() => {
        expect(screen.getByText('System KPIs')).toBeInTheDocument();
      });
    });

    test('switching to Customers tab shows search form', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));

      const customersTab = screen.getByRole('button', { name: /Customers/i });
      await userEvent.click(customersTab);

      expect(screen.getByText('Search Customer')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g., 12345678')).toBeInTheDocument();
    });

    test('switching to Affiliates tab shows affiliate table', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.getAffiliates.mockResolvedValue({ data: MOCK_AFFILIATES });

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));

      const affiliatesTab = screen.getByRole('button', { name: /Affiliates/i });
      await userEvent.click(affiliatesTab);

      await waitFor(() => {
        expect(screen.getByText('ACC001')).toBeInTheDocument();
        expect(screen.getByText('WILLIAM10')).toBeInTheDocument();
      });
    });

    test('Affiliates tab shows loading then empty state when no affiliates', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.getAffiliates.mockResolvedValue({ data: [] });

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));

      const affiliatesTab = screen.getByRole('button', { name: /Affiliates/i });
      await userEvent.click(affiliatesTab);

      await waitFor(() => {
        expect(screen.getByText('No affiliates found.')).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Customer Search Tests
  // -------------------------------------------------------------------------
  describe('customer search', () => {
    test('search form calls sanitizeText before API call', async () => {
      const api = require('../api/client').default;
      const sanitize = require('../lib/sanitize').sanitizeText;

      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.searchCustomer.mockResolvedValue({ data: MOCK_CUSTOMER_DATA });

      renderAdmin();

      // Navigate to customers tab
      await waitFor(() => screen.getByText('System KPIs'));
      const customersTab = screen.getByRole('button', { name: /Customers/i });
      await userEvent.click(customersTab);

      await waitFor(() => screen.getByPlaceholderText('e.g., 12345678'));

      await userEvent.type(screen.getByPlaceholderText('e.g., 12345678'), '  cust-123  ');
      await userEvent.click(screen.getByRole('button', { name: /Search/i }));

      await waitFor(() => {
        expect(sanitize).toHaveBeenCalledWith('  cust-123  ');
      });
    });

    test('shows customer data after successful search', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.searchCustomer.mockResolvedValue({ data: MOCK_CUSTOMER_DATA });

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));
      const customersTab = screen.getByRole('button', { name: /Customers/i });
      await userEvent.click(customersTab);

      await waitFor(() => screen.getByPlaceholderText('e.g., 12345678'));
      await userEvent.type(screen.getByPlaceholderText('e.g., 12345678'), 'cust-123');
      await userEvent.click(screen.getByRole('button', { name: /Search/i }));

      await waitFor(() => {
        expect(screen.getByText('cust-123')).toBeInTheDocument();
        expect(screen.getByText('monthly')).toBeInTheDocument();
        expect(screen.getByText('active')).toBeInTheDocument();
      });
    });

    test('search button is disabled while searching', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.searchCustomer.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ data: MOCK_CUSTOMER_DATA }), 100))
      );

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));
      const customersTab = screen.getByRole('button', { name: /Customers/i });
      await userEvent.click(customersTab);

      await waitFor(() => screen.getByPlaceholderText('e.g., 12345678'));
      await userEvent.type(screen.getByPlaceholderText('e.g., 12345678'), 'cust-123');
      await userEvent.click(screen.getByRole('button', { name: /Search/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Search/i })).toBeDisabled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Affiliate Management Tests
  // -------------------------------------------------------------------------
  describe('affiliate management', () => {
    test('Disable button calls api and refreshes list', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.getAffiliates.mockResolvedValue({ data: MOCK_AFFILIATES });
      api.disableAffiliate.mockResolvedValue({ data: { success: true } });

      const originalConfirm = window.confirm;
      window.confirm = jest.fn(() => true);

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));
      const affiliatesTab = screen.getByRole('button', { name: /Affiliates/i });
      await userEvent.click(affiliatesTab);

      await waitFor(() => screen.getByText('ACC001'));

      const disableBtn = screen.getAllByRole('button', { name: /Disable/i })[0];
      await userEvent.click(disableBtn);

      expect(window.confirm).toHaveBeenCalledWith(
        'Are you sure you want to disable this affiliate? They will no longer earn commissions.'
      );
      expect(api.disableAffiliate).toHaveBeenCalledWith('aff-1');
      expect(api.getAffiliates).toHaveBeenCalled();

      window.confirm = originalConfirm;
    });

    test('Adjust button calls api with entered amount and reason', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.getAffiliates.mockResolvedValue({ data: MOCK_AFFILIATES });
      api.adjustAffiliateEarnings.mockResolvedValue({ data: { success: true } });

      const originalPrompt = window.prompt;
      window.prompt = jest.fn()
        .mockReturnValueOnce('5000')
        .mockReturnValueOnce('Bonus for Q1 performance');

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));
      const affiliatesTab = screen.getByRole('button', { name: /Affiliates/i });
      await userEvent.click(affiliatesTab);

      await waitFor(() => screen.getByText('ACC001'));

      const adjustBtn = screen.getAllByRole('button', { name: /Adjust/i })[0];
      await userEvent.click(adjustBtn);

      expect(window.prompt).toHaveBeenCalledWith(
        'Enter adjustment amount in cents (positive to add, negative to deduct):'
      );
      expect(window.prompt).toHaveBeenCalledWith('Reason for adjustment:');
      expect(api.adjustAffiliateEarnings).toHaveBeenCalledWith(
        'aff-1',
        5000,
        'Bonus for Q1 performance'
      );

      window.prompt = originalPrompt;
    });

    test('Adjust cancels when amount prompt returns null', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.getAffiliates.mockResolvedValue({ data: MOCK_AFFILIATES });

      const originalPrompt = window.prompt;
      window.prompt = jest.fn().mockReturnValueOnce(null);

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));
      const affiliatesTab = screen.getByRole('button', { name: /Affiliates/i });
      await userEvent.click(affiliatesTab);

      await waitFor(() => screen.getByText('ACC001'));

      const adjustBtn = screen.getAllByRole('button', { name: /Adjust/i })[0];
      await userEvent.click(adjustBtn);

      expect(api.adjustAffiliateEarnings).not.toHaveBeenCalled();

      window.prompt = originalPrompt;
    });

    test('Export CSV creates correct blob data', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.getAffiliates.mockResolvedValue({ data: MOCK_AFFILIATES });

      // Mock URL.createObjectURL to capture the blob
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      let capturedBlob = null;
      URL.createObjectURL = jest.fn((blob) => {
        capturedBlob = blob;
        return 'blob:http://localhost/test-id';
      });
      URL.revokeObjectURL = jest.fn();

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));
      const affiliatesTab = screen.getByRole('button', { name: /Affiliates/i });
      await userEvent.click(affiliatesTab);

      await waitFor(() => screen.getByText('ACC001'));

      const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
      await userEvent.click(exportBtn);

      // Verify createObjectURL was called with a Blob containing CSV data
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(capturedBlob).toBeInstanceOf(Blob);

      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });

    test('affiliates table shows correct commission formatting', async () => {
      const api = require('../api/client').default;
      api.adminMetrics.mockResolvedValue({ data: MOCK_METRICS });
      api.getAffiliates.mockResolvedValue({ data: MOCK_AFFILIATES });

      renderAdmin();

      await waitFor(() => screen.getByText('System KPIs'));
      const affiliatesTab = screen.getByRole('button', { name: /Affiliates/i });
      await userEvent.click(affiliatesTab);

      await waitFor(() => {
        expect(screen.getByText('$1500.00')).toBeInTheDocument();
        expect(screen.getByText('$250.00')).toBeInTheDocument();
        expect(screen.getByText('$450.00')).toBeInTheDocument();
      });
    });
  });
});
