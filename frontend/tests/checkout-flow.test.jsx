/**
 * AhoyVPN Frontend — Checkout Flow Integration Test
 * =================================================
 * Tests that the Checkout page renders and composes with its extracted components.
 * 
 * WHY THIS TEST:
 * - Verifies the Checkout page correctly uses PlanSelector and crypto-only checkout UI
 * - Ensures the refactor (Task 4) didn't break the page's ability to render
 * - Acts as a smoke test for the checkout flow
 * 
 * KEY MOCKS:
 * - next/router: provides useRouter hook that Checkout uses for query.plan
 * - api.initiateCheckout: returns mock data so handleProceedToPayment doesn't fail
 */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Mock next/router BEFORE importing the component
jest.mock('next/router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/checkout',
    query: { plan: 'monthly' },
  }),
}));

// Mock the API client
jest.mock('../api/client', () => ({
  default: {
    get: jest.fn().mockResolvedValue({ data: { vpn_ready: true } }),
    initiateCheckout: jest.fn().mockResolvedValue({
      data: {
        pricing: {
          baseAmountCents: 599,
          discountCents: 0,
          taxAmountCents: 48,
          totalCents: 647,
          currency: 'USD',
        },
        redirectUrl: 'https://payments.cloud/process',
        invoice: null,
      },
    }),
  },
}));

// Create mock auth values
const mockAuthContext = {
  isLoggedIn: true,
  user: { id: 1 },
  login: jest.fn(),
  logout: jest.fn(),
};

// Mock _app.jsx to export AuthContext with a Provider
jest.mock('../pages/_app', () => {
  const React = require('react');
  const MockContext = React.createContext(mockAuthContext);
  return {
    AuthContext: MockContext,
  };
});

// Import the component AFTER mocks are set up
const Checkout = require('../pages/checkout').default;

// Helper to wrap components with our mock auth provider
const MockAuthProvider = ({ children }) => {
  const { AuthContext } = require('../pages/_app');
  return (
    <AuthContext.Provider value={mockAuthContext}>
      {children}
    </AuthContext.Provider>
  );
};

describe('Checkout Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the checkout page with "Get AHOY VPN" title', () => {
      render(<Checkout />, { wrapper: MockAuthProvider });
      expect(screen.getByText(/Get AHOY VPN/i)).toBeInTheDocument();
    });

    it('renders the plan selection step by default', () => {
      render(<Checkout />, { wrapper: MockAuthProvider });
      // Should show plan names from PLANS constant
      expect(screen.getByText('Monthly')).toBeInTheDocument();
      expect(screen.getByText('Annual')).toBeInTheDocument();
    });

    it('renders price information for plans', () => {
      render(<Checkout />, { wrapper: MockAuthProvider });
      expect(screen.getByText('$5.99')).toBeInTheDocument();
      expect(screen.getByText('$59.99')).toBeInTheDocument();
    });
  });

  describe('Plan Selection', () => {
    it('can navigate to payment step after selecting a plan', async () => {
      render(<Checkout />, { wrapper: MockAuthProvider });
      const user = userEvent.setup();

      // Click "Continue to Payment" button
      const continueBtn = screen.getByRole('button', { name: /continue to payment/i });
      await user.click(continueBtn);

      // Should now show payment step with Order Summary
      expect(screen.getByText(/Order Summary/i)).toBeInTheDocument();
    });
  });

  describe('Payment Step', () => {
    it('shows crypto checkout options when payment step is active', async () => {
      render(<Checkout />, { wrapper: MockAuthProvider });
      const user = userEvent.setup();

      // Advance to payment step
      const continueBtn = screen.getByRole('button', { name: /continue to payment/i });
      await user.click(continueBtn);

      // Should show crypto-only checkout options
      expect(screen.getByText('Cryptocurrency')).toBeInTheDocument();
      expect(screen.queryByText(/credit card/i)).not.toBeInTheDocument();
    });
  });
});
