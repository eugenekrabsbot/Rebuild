import Link from 'next/link';

const SECTIONS = [
  {
    title: 'Privacy-First Philosophy',
    content: 'AHOY VPN is built on the principle of privacy-first design. We believe your data is your own. We do not track, log, or store information about your online activities.',
  },
  {
    title: '1. What We DON\'T Collect',
    items: [
      'Email addresses (accounts use numeric IDs)',
      'Payment data (processed by third-party providers)',
      'Browsing history',
      'IP addresses of connections',
      'DNS queries',
      'Personally identifiable information beyond what is needed to operate legally, never stored on our servers, handled by third-party providers.',
    ],
  },
  {
    title: '2. What We Collect (Minimal)',
    items: [
      'Numeric user ID (for account identification)',
      'Hashed password (for authentication)',
      'Subscription status (active/inactive, plan type, billing date)',
      'Internal account IDs (for system management)',
      'Affiliate code attribution (if referral code used)',
      'The bare-minimum billing details: country, province/state, and postal code',
    ],
  },
  {
    title: '3. Numeric Account System',
    content: 'Your account is identified by a random 8-digit numeric ID. We do not require email addresses. This protects your identity and prevents tracking across services.',
  },
  {
    title: '4. Payment Information',
    content: `Payments are processed entirely by Plisio (cryptocurrency), and tax data is calculated by ZipTax. AHOY VPN never stores or handles payment card data on our own servers. Your payment information is handled and stored securely by these third-party providers.

We only accept cryptocurrency, which keeps the checkout flow simpler and avoids card data entirely.

All transactions will ask for country, province/state, and postal code prior to creating the checkout form due to sales tax liabilities.

Details such as cryptocurrency wallet information and tax jurisdiction information may exist briefly on our server while the system uses them, but are promptly disposed of afterward.

Our third-party tax/payment processors may handle data differently, which is why we are transparent about who we work with.`,
  },
  {
    title: '5. Subscription Data',
    content: 'We store only what is necessary to manage your subscription:',
    items: [
      'Your numeric ID',
      'Current plan (Monthly, Quarterly, Semi-Annual, Annual)',
      'Subscription status (Active, Cancelled, Expired)',
      'Next billing date',
      'Account creation date',
    ],
  },
  {
    title: '6. Affiliate Program & Cookie Tracking',
    content: 'If you use an affiliate referral link:',
    items: [
      'We set a cookie (30-day expiration) to track which affiliate referred you',
      'The cookie stores the affiliate ID only — no personal data',
      'If you make a purchase within 30 days, the affiliate gets credit',
      'Affiliate earnings are calculated based on subscription conversions',
      'You can clear affiliate cookies anytime by clearing your browser cookies',
    ],
    extra: `Cookies used for affiliate tracking: affiliate_id — stores the affiliate ID (30-day expiration), and persistent storage in browser localStorage as backup.`,
  },
  {
    title: '7. No Logs, No Tracking',
    content: 'Unlike traditional VPN providers, we do not log:',
    items: [
      'Your IP address',
      'Connection times or duration',
      'Data transferred',
      'Websites visited',
      'DNS queries',
    ],
  },
  {
    title: '8. Security',
    items: [
      'Passwords are hashed using bcrypt or scrypt (never stored in plaintext)',
      'Recovery kits are single-use and never stored',
      'Sensitive data requires re-authentication before access',
      'Copy-to-clipboard functions include warnings for sensitive data',
    ],
  },
  {
    title: '9. Third-Party Services',
    content: 'We use third-party services for:',
    items: [
      'Tax Calculation: ZipTax',
      'Payments: Plisio (crypto) — see their privacy policy',
      'Hosting & Security: NGINX (reverse proxy) and Cloudflare (reverse proxy/security)',
      'Analytics: Cloudflare Web Analytics (rum.js) — aggregate session data only, no PII stored',
    ],
    extra: 'These services may have their own privacy policies independent of ours.',
  },
  {
    title: '10. Data Retention',
    items: [
      'Account data is retained as long as your subscription is active',
      'Upon account deletion, all personal data is removed within 30 days',
      'Recovery kits are never stored (generated on-demand and single-use)',
      'Logs are not retained',
    ],
  },
  {
    title: '11. Your Rights',
    items: [
      'Download your account data',
      'Delete your account and all associated data',
      'Change your password anytime',
      'Request a new recovery kit',
    ],
  },
  {
    title: '12. Changes to Privacy Policy',
    content: 'We may update this policy at any time. Changes will be posted with an updated "Last updated" date. Continued use of AHOY VPN constitutes acceptance of the new policy.',
  },
  {
    title: '13. Cookie Disclosure',
    content: `AHOY VPN uses cookies for essential functionality and affiliate tracking:

Essential Cookies: Required for site functionality (no opt-out).
Affiliate Cookies: Track referral attribution (30-day expiration).

We also use Cloudflare Web Analytics (rum.js) which collects aggregate session data — approximate geographic location, device type, browser type, and page performance metrics — without cookies or any personally identifiable information. No individual users are tracked, and the data is owned by AHOY VPN.`,
  },
  {
    title: '14. Contact Us',
    content: 'Questions about privacy? Email us at ahoyvpn@ahoyvpn.net',
  },
  {
    title: '15. Enhancing Your Privacy',
    content: 'Want to go beyond VPN protection? Learn how to encrypt your DNS traffic to prevent your ISP and network administrators from seeing which websites you visit.',
    link: { href: '/dns-guide', text: 'View our DNS Encryption Guide →' },
  },
];

function renderContent(text) {
  // Split on blank lines to create paragraphs
  return text.split('\n\n').map((para, i) => (
    <p key={i} style={{ marginBottom: '1rem' }}>{para.trim()}</p>
  ));
}

export default function PrivacyPolicy() {
  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Privacy Policy</h1>
      <p style={styles.updated}>Last updated: March 5, 2026</p>

      <div style={styles.content}>
        {SECTIONS.map((section) => (
          <section key={section.title} className="prose-section">
            <h2>{section.title}</h2>
            {section.content && renderContent(section.content)}
            {section.items && (
              <ul>
                {section.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
            {section.extra && (
              <p style={{ marginTop: '0.75rem', color: '#8A8A8A', fontSize: '0.875rem' }}>{section.extra}</p>
            )}
            {section.link && (
              <p style={{ marginTop: '0.75rem' }}>
                <Link href={section.link.href} style={{ color: '#3B82F6', textDecoration: 'none', fontWeight: '500' }}>
                  {section.link.text}
                </Link>
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '780px',
    margin: '0 auto',
  },
  pageTitle: {
    fontSize: '2.5rem',
    color: '#F5F5F0',
    marginBottom: '0.5rem',
    letterSpacing: '-0.01em',
  },
  updated: {
    color: '#5A5A5A',
    marginBottom: '3rem',
    fontSize: '0.875rem',
  },
  content: {},
};
