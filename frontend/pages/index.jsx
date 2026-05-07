import { useState } from 'react';
import Link from 'next/link';
import Head from '../components/Head';
import { Button } from '../components/ui';

const FEATURES = [
  {
    title: 'Zero Logs',
    description: 'We never store your browsing activity, connection timestamps, or IP addresses.',
  },
  {
    title: 'Numeric Authentication',
    description: 'Accounts tied to numeric IDs — no email required, no personal data collected.',
  },
  {
    title: '10 Simultaneous Connections',
    description: 'Secure every device you own under a single subscription.',
  },
  {
    title: 'Recovery Kits',
    description: 'Self-custody account recovery. Your account, your keys — no password reset emails.',
  },
];

const PLANS = [
  {
    id: 'monthly',
    name: 'Monthly',
    price: '$5.99',
    period: '/month',
    badge: null,
  },
  {
    id: 'quarterly',
    name: 'Quarterly',
    price: '$16.99',
    period: '/quarter',
    badge: 'Best value',
  },
  {
    id: 'semi-annual',
    name: 'Semi-Annual',
    price: '$31.99',
    period: '/6 months',
    badge: 'Crypto only',
  },
  {
    id: 'annual',
    name: 'Annual',
    price: '$59.99',
    period: '/year',
    badge: 'Crypto only',
  },
];

const STEPS = [
  { step: '01', title: 'Register', description: 'Create an account with a numeric username and password. No email required.' },
  { step: '02', title: 'Subscribe', description: 'Choose a plan and pay securely via card or cryptocurrency.' },
  { step: '03', title: 'Connect', description: 'Download the client and connect to any of our global server locations.' },
];

// FAQ accordion item for homepage
function FAQHomeItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-home-item">
      <button
        className="faq-home-question"
        onClick={() => setOpen(!open)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          padding: '0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <span style={{ fontSize: '0.95rem', fontWeight: 500, color: '#F5F5F0' }}>{question}</span>
        <span style={{ color: '#3B82F6', fontSize: '1.1rem', flexShrink: 0 }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <p className="faq-home-answer" style={{ fontSize: '0.875rem', color: '#8A8A8A', lineHeight: 1.65, margin: 0 }}>
          {answer}
        </p>
      )}
    </div>
  );
}

// Top 6 FAQ items for homepage — same content as the full /faq page
const HOME_FAQS = [
  { q: 'How do I create an account?', a: 'Simply choose a plan on our homepage and proceed to checkout. After payment confirmation, we generate a numeric username and password for you. No email address required.' },
  { q: 'Do you keep logs of my activity?', a: 'No. We do not log or store any information about your online activities — no IP addresses, DNS queries, websites visited, or connection times.' },
  { q: 'What payment methods do you accept?', a: 'We accept credit and debit cards (via PaymentsCloud) and a wide range of cryptocurrencies (via Plisio).' },
  { q: 'How many devices can I connect?', a: 'All plans include up to 10 simultaneous connections under one account. Account sharing is not permitted.' },
  { q: 'What is a recovery kit?', a: 'A recovery kit is a unique code provided after account creation. If you lose your password, you can use this kit to recover your account and set a new password. Each kit is single-use.' },
  { q: 'How do I contact support?', a: 'Email us at ahoyvpn@ahoyvpn.net or use the Contact Support button in the footer. We aim to respond within 24 hours.' },
];

export default function Home() {
  return (
    <>
      <Head>
        <title>AHOY VPN - Privacy-First VPN. Zero Logs, Military-Grade Encryption</title>
        <meta name="description" content="AhoyVPN is a privacy-first VPN with zero logs, military-grade encryption, and no email required. Starting at $5.99/month with up to 10 simultaneous connections." />
        <meta name="keywords" content="VPN, privacy, secure, no logs, anonymous, encryption" />
        <meta property="og:title" content="AHOY VPN - Privacy-First VPN Service" />
        <meta property="og:description" content="Secure your internet connection with military-grade encryption. Zero logs, no tracking, no compromises." />
        <meta property="og:url" content="https://ahoyvpn.net" />
        <meta property="og:image" content="https://ahoyvpn.net/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@AhoyVPN" />
        <meta name="twitter:title" content="AHOY VPN - Privacy-First VPN Service" />
        <meta name="twitter:description" content="Secure your internet connection with military-grade encryption. Zero logs, no tracking, no compromises." />
        <link rel="canonical" href="https://ahoyvpn.net" />
      </Head>

      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'AhoyVPN',
            url: 'https://ahoyvpn.net',
            description: 'Privacy-first VPN service with zero logs, military-grade encryption, and no email required.',
            applicationCategory: 'SecurityApplication',
            operatingSystem: 'Windows, macOS, Linux, iOS, Android',
            offers: {
              '@type': 'Offer',
              price: '5.99',
              priceCurrency: 'USD',
              priceValidUntil: '2027-12-31',
            },
            publisher: {
              '@type': 'Organization',
              name: 'AhoyVPN',
              url: 'https://ahoyvpn.net',
            },
          }),
        }}
      />

      <div style={styles.page}>
      {/* Hero */}
      <section style={styles.hero}>
        <div style={styles.heroInner}>
          <p style={styles.heroEyebrow}>Privacy-first VPN</p>
          <h1 style={styles.heroTitle}>
            Your internet.<br />
            Your rules.
          </h1>
          <p style={styles.heroSubtitle}>
            Military-grade encryption. Zero logs. No tracking.<br />
            Starting at $5.99/month.
          </p>
          <div style={styles.heroCtas}>
            <Link href="/register" passHref>
              <Button as="a" size="lg" style={{ textDecoration: 'none' }}>
                Get Started
              </Button>
            </Link>
            <Link href="/faq" passHref>
              <Button variant="ghost" size="lg" as="a" style={{ textDecoration: 'none' }}>
                How it works
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Built for privacy</h2>
          <p style={styles.sectionSubtitle}>
            No surveillance. No data collection. No compromises.
          </p>
        </div>
        <div style={styles.featuresGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <h3 style={styles.featureTitle}>{f.title}</h3>
              <p style={styles.featureDesc}>{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Simple pricing</h2>
          <p style={styles.sectionSubtitle}>
            All plans include full access to our global network and premium features.
          </p>
        </div>
        <div style={styles.pricingGrid}>
          {PLANS.map((plan) => (
            <div key={plan.id} className="pricing-card">
              {plan.badge && (
                <span style={{
                  ...styles.pricingBadge,
                  backgroundColor: plan.badge === 'Best value' ? '#3B82F6' : 'transparent',
                  borderColor: plan.badge === 'Best value' ? '#3B82F6' : '#2E2E2E',
                  color: plan.badge === 'Best value' ? '#fff' : '#8A8A8A',
                }}>
                  {plan.badge}
                </span>
              )}
              <h3 style={styles.pricingName}>{plan.name}</h3>
              <div style={styles.pricingPrice}>
                {plan.price}
                <span style={styles.pricingPeriod}>{plan.period}</span>
              </div>
            </div>
          ))}
        </div>
        <p style={styles.pricingNote}>
          Card payments available for Monthly and Quarterly plans.{' '}
          <Link href="/faq" style={{ color: '#3B82F6' }}>Learn more</Link> about cryptocurrency options.
        </p>
      </section>

      {/* How It Works */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Up and running in minutes</h2>
        </div>
        <div style={styles.stepsGrid}>
          {STEPS.map((s, i) => (
            <div key={s.step} className="step-card">
              <span style={styles.stepNumber}>{s.step}</span>
              <h3 style={styles.stepTitle}>{s.title}</h3>
              <p style={styles.stepDesc}>{s.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ Section */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Frequently asked questions</h2>
          <p style={styles.sectionSubtitle}>
            Quick answers before you sign up.
          </p>
        </div>
        <div style={styles.faqGrid}>
          {HOME_FAQS.map((item, idx) => (
            <FAQHomeItem key={idx} question={item.q} answer={item.a} />
          ))}
        </div>
        <p style={styles.faqMoreLink}>
          Still have questions?{' '}
          <Link href="/faq" style={{ color: '#3B82F6', textDecoration: 'none' }}>
            View all FAQs →
          </Link>
        </p>
      </section>

      {/* CTA Banner */}
      <section style={styles.ctaBanner}>
        <h2 style={styles.ctaBannerTitle}>Ready to take back your privacy?</h2>
        <p style={styles.ctaBannerSubtitle}>Start with a plan that fits your needs.</p>
        <Link href="/register" passHref>
          <Button as="a" size="lg" style={{ textDecoration: 'none', marginTop: '1.5rem' }}>
            Get Started
          </Button>
        </Link>
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <div style={styles.footerSocial}>
          <a href="https://www.instagram.com/ahoy_vpn/" target="_blank" rel="noreferrer" style={styles.socialLink} aria-label="Follow AhoyVPN on Instagram">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png"
              alt="Instagram"
              width="20"
              height="20"
              style={{ display: 'block', aspectRatio: '1/1', objectFit: 'contain' }}
            />
            Instagram
          </a>
          <a href="https://www.facebook.com/AhoyVPN" target="_blank" rel="noreferrer" style={styles.socialLink} aria-label="Follow AhoyVPN on Facebook">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg"
              alt="Facebook"
              width="20"
              height="20"
              style={{ display: 'block', aspectRatio: '1/1', objectFit: 'contain' }}
            />
            Facebook
          </a>
        </div>
        <p style={styles.footerCopy}>&copy; {new Date().getFullYear()} AhoyVPN. All rights reserved.</p>
      </footer>
      </div>
    </>
  );
}

const styles = {
  page: { maxWidth: '100%' },

  hero: {
    padding: '5rem 1.5rem 4rem',
    textAlign: 'center',
    borderBottom: '1px solid #1E1E1E',
  },
  heroInner: { maxWidth: '640px', margin: '0 auto' },
  heroEyebrow: {
    fontSize: '0.8rem',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#3B82F6',
    marginBottom: '1.25rem',
  },
  heroTitle: {
    fontSize: 'clamp(2.25rem, 5vw, 3.5rem)',
    fontWeight: 700,
    lineHeight: 1.1,
    color: '#F5F5F0',
    marginBottom: '1.25rem',
    letterSpacing: '-0.02em',
  },
  heroSubtitle: {
    fontSize: '1.1rem',
    color: '#8A8A8A',
    lineHeight: 1.7,
    marginBottom: '2rem',
  },
  heroCtas: {
    display: 'flex',
    gap: '0.875rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },

  section: {
    padding: '4rem 1.5rem',
    maxWidth: '1100px',
    margin: '0 auto',
  },
  sectionHeader: { textAlign: 'center', marginBottom: '3rem' },
  sectionTitle: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#F5F5F0',
    marginBottom: '0.75rem',
    letterSpacing: '-0.01em',
  },
  sectionSubtitle: {
    fontSize: '1rem',
    color: '#8A8A8A',
    maxWidth: '480px',
    margin: '0 auto',
    lineHeight: 1.7,
  },

  featuresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '1px',
    border: '1px solid #2E2E2E',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  featureCard: {
    padding: '2rem 1.75rem',
    backgroundColor: '#1A1A1A',
    borderRight: '1px solid #2E2E2E',
    borderBottom: '1px solid #2E2E2E',
  },
  featureTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: '#F5F5F0',
    marginBottom: '0.625rem',
  },
  featureDesc: {
    fontSize: '0.875rem',
    color: '#8A8A8A',
    lineHeight: 1.65,
  },

  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  pricingCard: {
    position: 'relative',
    backgroundColor: '#1A1A1A',
    border: '1px solid #2E2E2E',
    borderRadius: '10px',
    padding: '1.75rem',
    textAlign: 'center',
    transition: 'border-color 0.2s ease',
  },
  pricingBadge: {
    position: 'absolute',
    top: '-1px',
    right: '1rem',
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    padding: '0.25rem 0.625rem',
    borderRadius: '0 0 6px 6px',
    border: '1px solid',
  },
  pricingName: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#8A8A8A',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '0.875rem',
  },
  pricingPrice: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#F5F5F0',
    letterSpacing: '-0.02em',
  },
  pricingPeriod: {
    fontSize: '0.9rem',
    fontWeight: 400,
    color: '#8A8A8A',
  },
  pricingNote: {
    fontSize: '0.875rem',
    color: '#5A5A5A',
    textAlign: 'center',
    lineHeight: 1.6,
  },

  stepsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  },
  step: {
    padding: '1.5rem 2rem',
  },
  stepNumber: {
    display: 'block',
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: '#3B82F6',
    marginBottom: '0.875rem',
  },
  stepTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#F5F5F0',
    marginBottom: '0.5rem',
  },
  stepDesc: {
    fontSize: '0.875rem',
    color: '#8A8A8A',
    lineHeight: 1.65,
  },

  faqGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginTop: '2rem',
    maxWidth: '720px',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  faqMoreLink: {
    textAlign: 'center',
    marginTop: '1.5rem',
    fontSize: '0.875rem',
    color: '#8A8A8A',
  },

  ctaBanner: {
    backgroundColor: '#111111',
    borderTop: '1px solid #2E2E2E',
    borderBottom: '1px solid #2E2E2E',
    padding: '4rem 1.5rem',
    textAlign: 'center',
    marginTop: '2rem',
  },
  ctaBannerTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#F5F5F0',
    marginBottom: '0.5rem',
  },
  ctaBannerSubtitle: {
    fontSize: '1rem',
    color: '#8A8A8A',
  },

  footer: {
    borderTop: '1px solid #1E1E1E',
    padding: '2rem 1.5rem',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
  },
  footerSocial: {
    display: 'flex',
    gap: '2rem',
    justifyContent: 'center',
    alignItems: 'center',
  },
  socialLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#8A8A8A',
    textDecoration: 'none',
    fontSize: '0.9rem',
    transition: 'color 0.2s ease',
  },
  footerCopy: {
    color: '#5A5A5A',
    fontSize: '0.8rem',
    margin: 0,
  },
};
