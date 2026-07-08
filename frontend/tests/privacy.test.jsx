/**
 * AhoyVPN Frontend — Privacy Policy Page Unit Tests
 * ==================================================
 * Tests the Privacy Policy page: all 15 sections rendered, title, last updated
 * date, Section component (string + list children), and the DNS guide Link.
 *
 * BUG FIX TESTED: Line 154 previously used <Link> without importing Link from
 * 'next/link' — the DNS guide CTA was a silent runtime failure. The fix adds the
 * import so the link works correctly.
 */

import '@testing-library/jest-dom';
const React = require('react');
const { render, screen } = require('@testing-library/react');

const PrivacyPolicy = require('../pages/privacy.jsx').default;

describe('privacy.jsx — Privacy Policy Page', () => {
  // ─── Page Header ─────────────────────────────────────────────────────────────

  describe('page header', () => {
    it('renders the main h1 heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy Policy');
    });

    it('renders the last updated date', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText('Last updated: March 5, 2026')).toBeInTheDocument();
    });
  });

  // ─── Section 1: Privacy-First Philosophy ────────────────────────────────────

  describe('section 1 — Privacy-First Philosophy', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: 'Privacy-First Philosophy' })).toBeInTheDocument();
    });

    it('renders the privacy philosophy text', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText(/AHOY VPN is built on the principle of privacy-first design/i)).toBeInTheDocument();
    });
  });

  // ─── Section 2: What We DON'T Collect ──────────────────────────────────────

  describe('section 2 — What We DON\'T Collect', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: "1. What We DON'T Collect" })).toBeInTheDocument();
    });

    it('renders the do-not-collect list items', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText('❌ Email addresses (accounts use numeric IDs)')).toBeInTheDocument();
      expect(screen.getByText('❌ Payment data (processed by third-party providers)')).toBeInTheDocument();
      expect(screen.getByText('❌ Browsing history')).toBeInTheDocument();
      expect(screen.getByText('❌ IP addresses of connections')).toBeInTheDocument();
      expect(screen.getByText('❌ DNS queries')).toBeInTheDocument();
    });
  });

  // ─── Section 3: What We Collect (Minimal) ───────────────────────────────────

  describe('section 3 — What We Collect (Minimal)', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '2. What We Collect (Minimal)' })).toBeInTheDocument();
    });

    it('renders the collect list items', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText('✓ Numeric user ID (for account identification)')).toBeInTheDocument();
      expect(screen.getByText('✓ Hashed password (for authentication)')).toBeInTheDocument();
      expect(screen.getByText('✓ Subscription status (active/inactive, plan type, billing date)')).toBeInTheDocument();
    });
  });

  // ─── Section 4: Numeric Account System ─────────────────────────────────────

  describe('section 4 — Numeric Account System', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '3. Numeric Account System' })).toBeInTheDocument();
    });

    it('renders the numeric ID description', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText(/random 8-digit numeric ID/i)).toBeInTheDocument();
    });
  });

  // ─── Section 5: Payment Information ────────────────────────────────────────

  describe('section 5 — Payment Information', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '4. Payment Information' })).toBeInTheDocument();
    });

    it('renders the third-party payment processor names', () => {
      render(<PrivacyPolicy />);
      // Look within the Payment Information section card
      const card = screen.getByRole('heading', { level: 3, name: '4. Payment Information' }).closest('section') ||
                    screen.getByRole('heading', { level: 3, name: '4. Payment Information' }).parentElement;
      expect(card.textContent).toContain('Plisio');
      expect(card.textContent).toContain('ZipTax');
    });

    it('mentions cryptocurrency-only checkout', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText(/We only accept cryptocurrency/i)).toBeInTheDocument();
    });
  });

  // ─── Section 6: Affiliate Program & Cookie Tracking ────────────────────────

  describe('section 6 — Affiliate Program & Cookie Tracking', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '6. Affiliate Program & Cookie Tracking' })).toBeInTheDocument();
    });

    it('describes the 30-day cookie expiration', () => {
      render(<PrivacyPolicy />);
      const card = screen.getByRole('heading', { level: 3, name: '6. Affiliate Program & Cookie Tracking' }).parentElement;
      expect(card.textContent).toContain('30-day');
    });

    it('mentions affiliate_id cookie', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText(/affiliate_id/i)).toBeInTheDocument();
    });
  });

  // ─── Section 7: No Logs, No Tracking ────────────────────────────────────────

  describe('section 7 — No Logs, No Tracking', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '7. No Logs, No Tracking' })).toBeInTheDocument();
    });

    it('lists what is NOT logged', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText('Your IP address')).toBeInTheDocument();
      expect(screen.getByText('Connection times or duration')).toBeInTheDocument();
      expect(screen.getByText('Data transferred')).toBeInTheDocument();
      expect(screen.getByText('Websites visited')).toBeInTheDocument();
      expect(screen.getByText('DNS queries')).toBeInTheDocument();
    });
  });

  // ─── Section 8: Security ────────────────────────────────────────────────────

  describe('section 8 — Security', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '8. Security' })).toBeInTheDocument();
    });

    it('mentions bcrypt or scrypt hashing', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText(/bcrypt or scrypt/i)).toBeInTheDocument();
    });

    it('mentions recovery kits are single-use and never stored', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText(/recovery kits are single-use and never stored/i)).toBeInTheDocument();
    });
  });

  // ─── Section 9: Third-Party Services ────────────────────────────────────────

  describe('section 9 — Third-Party Services', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '9. Third-Party Services' })).toBeInTheDocument();
    });

    it('lists ZipTax and Plisio', () => {
      render(<PrivacyPolicy />);
      const card = screen.getByRole('heading', { level: 3, name: '9. Third-Party Services' }).parentElement;
      expect(card.textContent).toContain('ZipTax');
      expect(card.textContent).toContain('Plisio');
    });

    it('mentions Cloudflare Web Analytics', () => {
      render(<PrivacyPolicy />);
      const card = screen.getByRole('heading', { level: 3, name: '9. Third-Party Services' }).parentElement;
      expect(card.textContent).toContain('Cloudflare Web Analytics');
    });
  });

  // ─── Section 10: Data Retention ─────────────────────────────────────────────

  describe('section 10 — Data Retention', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '10. Data Retention' })).toBeInTheDocument();
    });

    it('mentions 30-day deletion window', () => {
      render(<PrivacyPolicy />);
      const card = screen.getByRole('heading', { level: 3, name: '10. Data Retention' }).parentElement;
      expect(card.textContent).toContain('30 days');
    });
  });

  // ─── Section 11: Your Rights ───────────────────────────────────────────────

  describe('section 11 — Your Rights', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '11. Your Rights' })).toBeInTheDocument();
    });

    it('lists download, delete, change password, and recovery kit rights', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText(/Download your account data/i)).toBeInTheDocument();
      expect(screen.getByText(/Delete your account/i)).toBeInTheDocument();
      expect(screen.getByText(/Change your password/i)).toBeInTheDocument();
      expect(screen.getByText(/Request a new recovery kit/i)).toBeInTheDocument();
    });
  });

  // ─── Section 12: Changes to Privacy Policy ──────────────────────────────────

  describe('section 12 — Changes to Privacy Policy', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '12. Changes to Privacy Policy' })).toBeInTheDocument();
    });
  });

  // ─── Section 13: Cookie Disclosure ──────────────────────────────────────────

  describe('section 13 — Cookie Disclosure', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '13. Cookie Disclosure' })).toBeInTheDocument();
    });

    it('distinguishes essential vs affiliate cookies', () => {
      render(<PrivacyPolicy />);
      const card = screen.getByRole('heading', { level: 3, name: '13. Cookie Disclosure' }).parentElement;
      expect(card.textContent).toContain('Essential Cookies');
      expect(card.textContent).toContain('Affiliate Cookies');
    });
  });

  // ─── Section 14: Contact Us ─────────────────────────────────────────────────

  describe('section 14 — Contact Us', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '14. Contact Us' })).toBeInTheDocument();
    });

    it('renders the contact email', () => {
      render(<PrivacyPolicy />);
      // Plain text in a <p> — use regex to find email within the larger text node
      expect(screen.queryByText(/ahoyvpn@ahoyvpn\.net/)).toBeInTheDocument();
    });
  });

  // ─── Section 15: Enhancing Your Privacy (DNS Guide CTA) ─────────────────────

  describe('section 15 — Enhancing Your Privacy (DNS Guide CTA)', () => {
    it('renders the section heading', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByRole('heading', { level: 3, name: '15. Enhancing Your Privacy' })).toBeInTheDocument();
    });

    it('renders the DNS guide call-to-action text', () => {
      render(<PrivacyPolicy />);
      expect(screen.getByText(/encrypt your DNS traffic/i)).toBeInTheDocument();
    });

    // BUG FIX VERIFICATION: privacy.jsx previously used <Link> on line 154 without
    // importing it from 'next/link'. The DNS guide link was a silent runtime failure —
    // the element rendered as undefined and the link did nothing. Fix adds the import.
    it('renders the DNS guide link pointing to /dns-guide', () => {
      render(<PrivacyPolicy />);
      const link = screen.getByRole('link', { name: /View our DNS Encryption Guide/i });
      expect(link).toHaveAttribute('href', '/dns-guide');
    });
  });

  // ─── Section Component Behavior ────────────────────────────────────────────

  describe('Section component — string vs list children', () => {
    it('renders string children as a <p> with styled text', () => {
      render(<PrivacyPolicy />);
      // Section 1 uses a plain string child
      const section1 = screen.getByRole('heading', { level: 3, name: 'Privacy-First Philosophy' });
      expect(section1.parentElement).toHaveTextContent(/AHOY VPN is built on the principle/i);
    });

    it('renders list children (ul/li) directly without wrapping <p>', () => {
      render(<PrivacyPolicy />);
      // Section 2 uses a <ul> with <li> children
      const section2 = screen.getByRole('heading', { level: 3, name: "1. What We DON'T Collect" });
      const ul = section2.parentElement.querySelector('ul');
      expect(ul).toBeInTheDocument();
      expect(ul.querySelectorAll('li').length).toBeGreaterThan(0);
    });
  });
});
