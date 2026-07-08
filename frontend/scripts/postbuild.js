#!/usr/bin/env node
/**
 * postbuild.js — Comprehensive SEO + Core Web Vitals patch for static Next.js export.
 *
 * SEO INJECTIONS (per page):
 *   • <title>           — page-specific titles (overwrite Next.js defaults)
 *   • <h1>              — hidden, for search engines to find
 *   • JSON-LD           — page-specific structured data
 *   • Open Graph        — og:title, og:description, og:url per page
 *   • Twitter Card     — twitter:card, twitter:title, twitter:description
 *   • Canonical URL    — rel=canonical pointing to ahoyvpn.net
 *
 * CORE WEB VITALS FIXES:
 *   • Google Fonts     — non-blocking load (no render-blocking <link rel=stylesheet>)
 *
 * Run AFTER `npm run build`.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'out');
const BASE_URL = 'https://ahoyvpn.net';

// ── Shared helpers ────────────────────────────────────────────────────────────
const securityHeaders = [
  '<meta http-equiv="Strict-Transport-Security" content="max-age=31536000; includeSubDomains; preload" />',
  '<meta http-equiv="X-Content-Type-Options" content="nosniff" />',
  '<meta http-equiv="X-Frame-Options" content="DENY" />',
  '<meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin" />',
  '<meta http-equiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=()" />',
].join('');

const faviconLink    = '<link rel="icon" href="/favicon.ico" />';
const appleTouchIcon = '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';

// Non-blocking Google Fonts load (eliminates render-blocking)
// Replaces: <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;...
const fontLoader = `<script>
(function() {
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=block';
  link.type = 'text/css';
  document.head.appendChild(link);
})();
</script>`;

// Canonical tag (per page)
function canonical(url) {
  return `<link rel="canonical" href="${url}" />`;
}

// Twitter Card meta (base — page-specific overrides override title/desc)
const twitterCard = [
  '<meta name="twitter:card" content="summary_large_image" />',
  '<meta name="twitter:url" content="__URL__" />',
  '<meta name="twitter:title" content="__TITLE__" />',
  '<meta name="twitter:description" content="__DESC__" />',
  '<meta name="twitter:image" content="https://ahoyvpn.net/og-image.png" />',
].join('');

function twitterMeta(url, title, desc) {
  return twitterCard
    .replace('__URL__', url)
    .replace('__TITLE__', title)
    .replace('__DESC__', desc);
}

// ── Page definitions ───────────────────────────────────────────────────────────
const PAGES = {
  'index': {
    title: 'AHOY VPN - Privacy-First VPN. Zero Logs, Military-Grade Encryption',
    description: 'AHOY VPN - Privacy-first VPN service with zero logs and no tracking. Fast, secure, and affordable.',
    h1: 'Your internet. Your rules.',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://ahoyvpn.net/#organization',
          name: 'AhoyVPN',
          url: 'https://ahoyvpn.net',
          logo: 'https://ahoyvpn.net/og-image.png',
        },
        {
          '@type': 'WebSite',
          '@id': 'https://ahoyvpn.net/#website',
          url: 'https://ahoyvpn.net',
          name: 'AhoyVPN',
          publisher: { '@id': 'https://ahoyvpn.net/#organization' },
          potentialAction: {
            '@type': 'SearchAction',
            target: 'https://ahoyvpn.net/?s={search_term_string}',
            'query-input': 'required name=search_term_string',
          },
        },
        {
          '@type': 'VPNService',
          '@id': 'https://ahoyvpn.net/#vpnservice',
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
            availability: 'https://schema.org/InStock',
          },
          publisher: { '@id': 'https://ahoyvpn.net/#organization' },
          areaServed: { '@type': 'Worldwide' },
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: 'VPN Plans',
            itemListElement: [
              {
                '@type': 'Offer',
                itemOffered: { '@type': 'Service', name: 'AhoyVPN Monthly' },
                price: '5.99',
                priceCurrency: 'USD',
              },
              {
                '@type': 'Offer',
                itemOffered: { '@type': 'Service', name: 'AhoyVPN Yearly' },
                price: '49.99',
                priceCurrency: 'USD',
              },
            ],
          },
        },
        {
          '@type': 'FAQPage',
          '@id': 'https://ahoyvpn.net/#faq',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'What is a VPN?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'A VPN (Virtual Private Network) encrypts your internet connection and hides your IP address, keeping your online activity private from your ISP, hackers, and surveillance.',
              },
            },
            {
              '@type': 'Question',
              name: 'Does AhoyVPN keep logs?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'No. AhoyVPN follows a strict zero-logs policy. We do not track, store, or share your browsing activity, connection timestamps, or IP addresses.',
              },
            },
            {
              '@type': 'Question',
              name: 'How fast is AhoyVPN?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'AhoyVPN uses high-speed servers optimized for streaming, gaming, and everyday browsing. Speed may vary based on location and server load.',
              },
            },
          ],
        },
      ],
    },
  },

  'faq': {
    title: 'Frequently Asked Questions | AHOY VPN',
    description: 'Answers to the most common questions about AhoyVPN — zero-logs policy, pricing, speed, device support, and more.',
    h1: 'Frequently Asked Questions',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      name: 'AhoyVPN FAQ',
      description: 'Frequently asked questions about AhoyVPN VPN service.',
      publisher: { '@type': 'Organization', name: 'AhoyVPN', url: 'https://ahoyvpn.net' },
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is a VPN?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'A VPN (Virtual Private Network) encrypts your internet connection and hides your IP address, keeping your online activity private from your ISP, hackers, and surveillance.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does AhoyVPN keep logs?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. AhoyVPN follows a strict zero-logs policy. We do not track, store, or share your browsing activity, connection timestamps, or IP addresses.',
          },
        },
        {
          '@type': 'Question',
          name: 'How fast is AhoyVPN?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AhoyVPN uses high-speed servers optimized for streaming, gaming, and everyday browsing. Speed may vary based on location and server load.',
          },
        },
        {
          '@type': 'Question',
          name: 'How many devices can I connect?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'You can connect up to 5 devices simultaneously with a single AhoyVPN subscription.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does AhoyVPN work on mobile?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. AhoyVPN supports iOS, Android, Windows, macOS, and Linux.',
          },
        },
        {
          '@type': 'Question',
          name: 'What payment methods are accepted?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AhoyVPN only accepts cryptocurrency payments via Plisio.',
          },
        },
      ],
    },
  },

  'affiliate': {
    title: 'Affiliate Program | AHOY VPN',
    description: 'Earn commissions by referring customers to AhoyVPN. 25% recurring commission, fast payouts, real-time tracking.',
    h1: 'Affiliate Program',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'AhoyVPN Affiliate Program',
      url: 'https://ahoyvpn.net/affiliate',
      description: 'Earn 25% recurring commission for every customer you refer to AhoyVPN.',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any',
      offers: {
        '@type': 'Offer',
        description: '25% recurring commission, $0.75 minimum payout',
        priceCurrency: 'USD',
      },
      publisher: { '@type': 'Organization', name: 'AhoyVPN', url: 'https://ahoyvpn.net' },
    },
  },

  'dns-guide': {
    title: 'DNS Setup Guide | AHOY VPN',
    description: 'Step-by-step guide to configure DNS settings for AhoyVPN on any device — Windows, macOS, iOS, Android, and routers.',
    h1: 'DNS Setup Guide',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      name: 'AhoyVPN DNS Setup Guide',
      description: 'How to configure DNS settings with AhoyVPN on any device.',
      publisher: { '@type': 'Organization', name: 'AhoyVPN', url: 'https://ahoyvpn.net' },
      datePublished: '2026-01-01',
      about: {
        '@type': 'Thing',
        name: 'VPN DNS Configuration',
      },
      steps: [
        {
          '@type': 'HowToStep',
          name: 'Open DNS settings',
          text: 'Navigate to your device network settings and find the DNS configuration panel.',
        },
        {
          '@type': 'HowToStep',
          name: 'Enter AhoyVPN DNS servers',
          text: 'Replace your current DNS servers with the AhoyVPN DNS addresses provided in your dashboard.',
        },
        {
          '@type': 'HowToStep',
          name: 'Save and test',
          text: 'Save your settings and visit a website to confirm your DNS is routing through AhoyVPN.',
        },
      ],
    },
  },

  'pricing': {
    title: 'Pricing | AHOY VPN',
    description: 'Simple, affordable VPN plans starting at $5.99/month. No hidden fees. Cancel anytime.',
    h1: 'Simple, Transparent Pricing',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'PriceList',
      name: 'AhoyVPN Pricing',
      publisher: { '@type': 'Organization', name: 'AhoyVPN', url: 'https://ahoyvpn.net' },
      offers: {
        '@type': 'AggregateOffer',
          lowPrice: '5.99',
          priceCurrency: 'USD',
          offerCount: '2',
      },
    },
  },

  // ── Generic pages (Organization + WebSite JSON-LD) ───────────────────────
  'dashboard': {
    title: 'Dashboard | AHOY VPN',
    description: 'Manage your AhoyVPN subscription, view VPN credentials, and billing details.',
    h1: 'Dashboard',
  },
  'login': {
    title: 'Login | AHOY VPN',
    description: 'Log in to your AhoyVPN account to access your dashboard and VPN credentials.',
    h1: 'Login',
  },
  'register': {
    title: 'Register | AHOY VPN',
    description: 'Create your AhoyVPN account. No email required. Start protecting your privacy in minutes.',
    h1: 'Create Account',
  },
  'recover': {
    title: 'Recover Account | AHOY VPN',
    description: 'Recover your AhoyVPN account using your recovery kit.',
    h1: 'Recover Your Account',
  },
  'checkout': {
    title: 'Checkout | AHOY VPN',
    description: 'Complete your AhoyVPN purchase securely with cryptocurrency.',
    h1: 'Secure Checkout',
  },
  'payment-success': {
    title: 'Payment Successful | AHOY VPN',
    description: 'Your AhoyVPN payment was successful. Your VPN account is being activated.',
    h1: 'Payment Confirmed',
  },
  'contact': {
    title: 'Contact Us | AHOY VPN',
    description: 'Get in touch with the AhoyVPN team. We respond to all inquiries within 24 hours.',
    h1: 'Contact AhoyVPN',
  },
  'privacy': {
    title: 'Privacy Policy | AHOY VPN',
    description: 'AhoyVPN privacy policy — how we collect, use, and protect your data.',
    h1: 'Privacy Policy',
  },
  'tos': {
    title: 'Terms of Service | AHOY VPN',
    description: 'AhoyVPN terms of service — acceptable use, responsibilities, and limitations.',
    h1: 'Terms of Service',
  },
  'affiliate-agreement': {
    title: 'Affiliate Agreement | AHOY VPN',
    description: 'Official affiliate program terms and conditions for AhoyVPN partners.',
    h1: 'Affiliate Agreement',
  },
  'downloads': {
    title: 'Downloads | AHOY VPN',
    description: 'Download AhoyVPN apps for Windows, macOS, Linux, iOS, and Android.',
    h1: 'Downloads',
  },
  'admin': {
    title: 'Admin | AHOY VPN',
    description: 'AhoyVPN admin panel.',
    h1: 'Admin',
  },
  'ahoyman': {
    title: 'Ahoyman | AHOY VPN',
    description: 'AhoyVPN management dashboard.',
    h1: 'Ahoyman',
  },
  'ahoyman-dashboard': {
    title: 'Ahoyman Dashboard | AHOY VPN',
    description: 'AhoyVPN management metrics.',
    h1: 'Ahoyman Dashboard',
  },
  'affiliate-dashboard': {
    title: 'Affiliate Dashboard | AHOY VPN',
    description: 'Track your referrals, commissions, and payouts.',
    h1: 'Affiliate Dashboard',
  },
  '404': {
    title: '404 - Page Not Found | AHOY VPN',
    description: 'The page you were looking for could not be found.',
    h1: 'Page Not Found',
  },
};

// ── Generic JSON-LD for pages without a custom schema ──────────────────────────
const genericJsonLd = (pageUrl, pageName) => ({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${BASE_URL}/#organization`,
      name: 'AhoyVPN',
      url: BASE_URL,
      logo: `${BASE_URL}/og-image.png`,
    },
    {
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      url: BASE_URL,
      name: 'AhoyVPN',
      publisher: { '@id': `${BASE_URL}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${BASE_URL}/?s={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ],
});

// ── Core Web Vitals: fix Google Fonts render-blocking ─────────────────────────
function patchFonts(html) {
  // Remove blocking <link rel="stylesheet" href="https://fonts.googleapis.com/...">
  // Replace with non-blocking script injection
  if (html.includes('fonts.googleapis.com')) {
    // Remove all blocking font stylesheets
    html = html.replace(
      /<link[^>]*href=["']https:\/\/fonts\.googleapis\.com[^"']*["'][^>]*>/g,
      ''
    );
    // Inject non-blocking loader before </body> or before </head>
    if (!html.includes('fontLoader')) {
      html = html.replace('</body>', fontLoader + '</body>', 1);
    }
  }
  return html;
}

// ── Per-page SEO injection ────────────────────────────────────────────────────
function patchPage(filePath, filename) {
  if (!fs.existsSync(filePath)) return;

  let html = fs.readFileSync(filePath, 'utf8');

  // ── Core Web Vitals: fix Google Fonts render-blocking ──────────────────
  html = patchFonts(html);

  // ── Security headers ──────────────────────────────────────────────────
  if (!html.includes('X-Frame-Options')) {
    html = html.replace('</head>', securityHeaders + '</head>', 1);
  }

  // ── Favicon ────────────────────────────────────────────────────────────
  if (!html.includes('favicon.ico')) {
    html = html.replace('<head>', '<head>' + faviconLink + appleTouchIcon, 1);
  }

  // ── Determine page key ────────────────────────────────────────────────
  // affiliate/[code].html → affiliate  |  dns-guide.html → dns-guide
  const pageKey = filename.replace('.html', '').split('/')[0];

  const page = PAGES[pageKey];
  const pageUrl = pageKey === 'index' ? BASE_URL : `${BASE_URL}/${pageKey}`;

  // ── <title> ─────────────────────────────────────────────────────────────
  const title = page?.title || `${pageKey} | AHOY VPN`;
  // Next.js bakes <title> into static HTML (e.g. <title>FAQ | AHOY VPN</title>)
  // Use regex to detect any existing title tag, then replace it
  if (/<title>[^<]*<\/title>/.test(html)) {
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  } else if (!html.includes(`<title>${title}</title>`)) {
    // No title tag at all — inject before </head>
    html = html.replace('</head>', `<title>${title}</title></head>`, 1);
  }

  // ── Canonical URL — replace Next.js default or inject fresh ───────
  const ogDesc = page?.description || 'Privacy-first VPN service with zero logs, military-grade encryption, and no email required.';
  if (/<link[^>]*rel="canonical"[^>]*>/.test(html)) {
    html = html.replace(/<link[^>]*rel="canonical"[^>]*>/, canonical(pageUrl));
  } else if (!html.includes('rel="canonical"')) {
    html = html.replace('</head>', canonical(pageUrl) + '</head>', 1);
  }

  // ── Open Graph — replace Next.js defaults (same greedy fix) ───────────
  if (/<meta[^>]*property="og:title"[^>]*>/.test(html)) {
    html = html.replace(/<meta[^>]*property="og:title"[^>]*>/, `<meta property="og:title" content="${title}" />`);
  }
  if (/<meta[^>]*property="og:url"[^>]*>/.test(html)) {
    html = html.replace(/<meta[^>]*property="og:url"[^>]*>/, `<meta property="og:url" content="${pageUrl}" />`);
  }
  if (/<meta[^>]*property="og:description"[^>]*>/.test(html)) {
    html = html.replace(/<meta[^>]*property="og:description"[^>]*>/, `<meta property="og:description" content="${ogDesc}" />`);
  }

  // ── Twitter Card — replace Next.js defaults ──────────────────────────
  if (/<meta[^>]*name="twitter:title"[^>]*>/.test(html)) {
    html = html.replace(/<meta[^>]*name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}" />`);
  }
  if (/<meta[^>]*name="twitter:description"[^>]*>/.test(html)) {
    html = html.replace(/<meta[^>]*name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${ogDesc}" />`);
  }
  if (/<meta[^>]*name="twitter:url"[^>]*>/.test(html)) {
    html = html.replace(/<meta[^>]*name="twitter:url"[^>]*>/, `<meta name="twitter:url" content="${pageUrl}" />`);
  }

  // ── Hidden <h1> ────────────────────────────────────────────────────────
  if (page?.h1 && !html.includes('data-seo-h1')) {
    html = html.replace('<div id="__next">', `<div id="__next"><h1 data-seo-h1 style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true">${page.h1}</h1>`, 1);
  } else if (page?.h1) {
    // Replace existing hidden h1
    html = html.replace(/<h1 data-seo-h1[^>]*>.*?<\/h1>/, `<h1 data-seo-h1 style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true">${page.h1}</h1>`);
  }

  // ── JSON-LD ─────────────────────────────────────────────────────────────
  let jsonLdObj = null;
  if (page?.jsonLd) {
    jsonLdObj = page.jsonLd;
  } else if (PAGES[pageKey]) {
    jsonLdObj = genericJsonLd(pageUrl, title);
  }

  if (jsonLdObj) {
    const jsonLdScript = `<script type="application/ld+json">${JSON.stringify(jsonLdObj, null, 0)}</script>`;
    if (!html.includes('application/ld+json')) {
      html = html.replace('</head>', jsonLdScript + '</head>', 1);
    }
  }

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  patched: ${filename}`);
}

// ── Recursive HTML collector ─────────────────────────────────────────────────
function getAllHtmlFiles(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllHtmlFiles(full));
    } else if (entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('postbuild.js: starting...');
const htmlFiles = getAllHtmlFiles(OUT);
console.log(`  found ${htmlFiles.length} HTML pages`);
for (const file of htmlFiles) {
  const filename = file.replace(OUT + '/', '');
  patchPage(file, filename);
}
console.log('postbuild.js: done — all pages patched');