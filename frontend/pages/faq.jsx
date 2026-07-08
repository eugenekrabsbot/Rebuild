import { useState } from 'react';
import Link from 'next/link';
import { Card } from '../components/ui';

const FAQS = [
  {
    question: 'What is AHOY VPN?',
    answer:
      'AHOY VPN is a privacy-first virtual private network (VPN) service. We encrypt your internet traffic and route it through our servers to mask your IP address and location. Unlike traditional VPN providers, we do not log your activity.',
  },
  {
    question: 'Do you offer free trials?',
    answer: 'No. AHOY VPN does not offer free trials. Access duration varies by plan (1-12 months depending on subscription). You can cancel anytime.',
  },
  {
    question: 'How do I create an account?',
    answer:
      'Simply choose a plan on our homepage and proceed to checkout. After payment confirmation, we generate a numeric username and password for you. No email address required—your account is identified by a random 8-digit numeric ID.',
  },
  {
    question: 'What is a numeric username and password?',
    answer:
      'Unlike traditional services, AHOY VPN uses numeric credentials to protect your privacy. Your username and password are both numbers generated randomly after account creation. This means no email address is required to sign up.',
  },
  {
    question: 'What is a recovery kit?',
    answer:
      'A recovery kit is a unique code provided after account creation. If you lose your password, you can use this kit to recover your account and set a new password. Each recovery kit is single-use and generates a new kit upon use. Keep it secure!',
  },
  {
    question: 'How do I use my recovery kit?',
    answer:
      'Visit our login page and click "Use Recovery Kit". Enter your numeric user ID and the recovery kit code. Upon verification, you can set a new password and receive a new recovery kit.',
  },
  {
    question: 'What if I lose both my password and recovery kit?',
    answer:
      'Unfortunately, without your recovery kit, account recovery is not possible. This is by design—we cannot access your account without credentials. Always store your recovery kit in a secure location.',
  },
  {
    question: 'Do you track my browsing activity?',
    answer:
      'No. We do not log or store any information about your online activities. We do not track IP addresses, DNS queries, websites visited, or connection times. Your privacy is our priority.',
  },
  {
    question: 'Do you store payment information?',
    answer:
      'No. Payments are processed by Plisio for cryptocurrency, and AHOY VPN never stores payment data on our own servers.',
  },
  {
    question: 'What payment methods do you accept?',
    answer:
      'We accept cryptocurrency only. All checkout payments are processed through Plisio.',
  },
  {
    question: 'Which cryptocurrencies do you accept?',
    answer:
      'Through Plisio we support many coins, including Bitcoin (BTC), Litecoin (LTC), Dash (DASH), Zcash (ZEC), Dogecoin (DOGE), Bitcoin Cash (BCH), Monero (XMR), Ethereum (ETH), Ethereum Classic (ETC), Solana (SOL), Tron (TRX), USDC and USDT variants on multiple chains (ERC-20, TRC-20, BSC), Binance USD (BUSD), Toncoin (TON), ApeCoin (APE), Love Bit (LOVE), BitTorrent-Chain (BTTC), Shiba Inu (SHIB), and others listed on the Plisio checkout page. The exact list may change over time as Plisio updates supported currencies.',
  },
  {
    question: 'How do I cancel my subscription?',
    answer:
      'You can cancel your subscription anytime from your dashboard. Cancellation is effective immediately. You will not be charged for the next billing cycle.',
  },

  {
    question: 'Which servers does AHOY VPN have?',
    answer:
      'We have 50+ server locations worldwide, including North America, Europe, Asia, and Oceania. Connect to any location to mask your IP address.',
  },
  {
    question: 'How many simultaneous connections can I have?',
    answer:
      'All plans grant access to up to 10 simultaneous connections for one user. We forbid account sharing.',
  },
  {
    question: 'Is AHOY VPN legal?',
    answer:
      'VPN services are legal in most countries. However, using a VPN to engage in illegal activities is not legal. Always use VPN services responsibly and in accordance with local laws.',
  },
  {
    question: 'What encryption does AHOY VPN use?',
    answer:
      'We use military-grade encryption (AES-256) to secure your data. Your traffic is encrypted from your device to our servers, ensuring privacy and security.',
  },

  {
    question: 'How fast is AHOY VPN?',
    answer:
      'Our servers are optimized for speed. Most users experience minimal speed loss compared to their regular connection. Actual speed depends on your ISP, location, and network conditions.',
  },
  {
    question: 'Do you have a no-logs policy?',
    answer:
      'Yes, we have a strict no-logs policy. We do not store IP addresses, connection times, websites visited, or any other activity data. Your privacy is guaranteed.',
  },
  {
    question: 'How do I contact support?',
    answer: 'Email us at ahoyvpn@ahoyvpn.net for support inquiries. We aim to respond within 24 hours.',
  },
];

export default function FAQ() {
  const [expandedIndex, setExpandedIndex] = useState(null);

  const toggleFAQ = (index) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Frequently Asked Questions</h1>
      <p style={styles.subtitle}>
        Can't find what you're looking for? Email us at{' '}
        <a href="mailto:ahoyvpn@ahoyvpn.net" style={styles.emailLink} aria-label="Email AhoyVPN support">
          ahoyvpn@ahoyvpn.net
        </a>
      </p>

      <div style={styles.faqList}>
        {FAQS.map((faq, index) => (
          <FAQItem
            key={index}
            question={faq.question}
            answer={faq.answer}
            isExpanded={expandedIndex === index}
            onToggle={() => toggleFAQ(index)}
          />
        ))}
      </div>

      <Card style={{ marginTop: '3rem', padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#1E90FF' }}>Want to enhance your privacy further?</h2>
        <p style={{ marginBottom: '1rem', color: '#B0C4DE', lineHeight: 1.6 }}>
          Learn how to encrypt your DNS traffic to prevent your ISP and network administrators from seeing which websites you visit—even when you're not using a VPN.
        </p>
        <Link href="/dns-guide" style={{ color: '#1E90FF', textDecoration: 'none', fontWeight: '500', fontSize: '1.1rem' }}>
          View our DNS Encryption Guide →
        </Link>
      </Card>
    </div>
  );
}

function FAQItem({ question, answer, isExpanded, onToggle }) {
  return (
    <div
      style={{
        ...styles.faqItem,
        ...(isExpanded && styles.faqItemExpanded),
      }}
    >
      <button onClick={onToggle} style={styles.faqQuestion}>
        <span style={styles.faqQuestionText}>{question}</span>
        <span style={styles.faqIcon}>{isExpanded ? '−' : '+'}</span>
      </button>
      {isExpanded && (
        <div style={styles.faqAnswer}>
          <p>{answer}</p>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
  },

  title: {
    fontSize: '2.5rem',
    color: '#1E90FF',
    marginBottom: '0.5rem',
    textAlign: 'center',
  },

  subtitle: {
    fontSize: '1.1rem',
    color: '#B0C4DE',
    textAlign: 'center',
    marginBottom: '2rem',
  },

  emailLink: {
    color: '#1E90FF',
    textDecoration: 'underline',
  },

  faqList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },

  faqItem: {
    backgroundColor: '#252525',
    border: '1px solid #3A3A3A',
    borderRadius: '8px',
    overflow: 'hidden',
    transition: 'all 0.3s ease',
  },

  faqItemExpanded: {
    backgroundColor: '#2A2A2A',
    borderColor: '#1E90FF',
    boxShadow: '0 4px 12px rgba(30, 144, 255, 0.1)',
  },

  faqQuestion: {
    width: '100%',
    padding: '1.5rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '1rem',
    fontWeight: 500,
    color: '#F0F4F8',
    transition: 'all 0.3s ease',
  },

  faqQuestionText: {
    textAlign: 'left',
    flex: 1,
  },

  faqIcon: {
    fontSize: '1.5rem',
    color: '#1E90FF',
    marginLeft: '1rem',
    flexShrink: 0,
  },

  faqAnswer: {
    padding: '0 1.5rem 1.5rem 1.5rem',
    borderTop: '1px solid #3A3A3A',
    color: '#B0C4DE',
    lineHeight: 1.8,
    animation: 'slideDown 0.3s ease',
  },
};
