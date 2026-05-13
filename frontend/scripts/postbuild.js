#!/usr/bin/env node
/**
 * postbuild.js — Patches all static HTML pages after Next.js static export.
 *
 * For index.html: Adds <title>, JSON-LD schema, hidden H1 for SEO.
 * For ALL pages:  Adds security headers, favicon link, proper meta tags.
 *
 * Run AFTER `npm run build` in the Next.js build pipeline.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'out');

// ── Shared meta (applied to every page) ──────────────────────────────────────
const securityHeaders = [
  '<meta http-equiv="Strict-Transport-Security" content="max-age=31536000; includeSubDomains; preload" />',
  '<meta http-equiv="X-Content-Type-Options" content="nosniff" />',
  '<meta http-equiv="X-Frame-Options" content="DENY" />',
  '<meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin" />',
  '<meta http-equiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=()" />',
].join('');

const faviconLink = '<link rel="icon" href="/favicon.ico" />';
const appleTouchIcon = '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';

// ── Index-only SEO ────────────────────────────────────────────────────────────
const indexTitle = 'AHOY VPN - Privacy-First VPN. Zero Logs, Military-Grade Encryption';
const indexDescription = 'AHOY VPN - Privacy-first VPN service with zero logs and no tracking. Fast, secure, and affordable.';
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'AhoyVPN',
  url: 'https://ahoyvpn.net',
  description: 'Privacy-first VPN service with zero logs, military-grade encryption, and no email required.',
  applicationCategory: 'SecurityApplication',
  operatingSystem: 'Windows, macOS, Linux, iOS, Android',
  offers: { '@type': 'Offer', price: '5.99', priceCurrency: 'USD', priceValidUntil: '2027-12-31' },
  publisher: { '@type': 'Organization', name: 'AhoyVPN', url: 'https://ahoyvpn.net' },
};
const hiddenH1 = '<h1 data-seo-h1 style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true">Your internet. Your rules.</h1>';

const indexJsonLd = `<script type="application/ld+json">${JSON.stringify(jsonLd, null, 0)}</script>`;

// ── Per-page titles ────────────────────────────────────────────────────────────
const pageTitles = {
  'index':            'AHOY VPN - Privacy-First VPN. Zero Logs, Military-Grade Encryption',
  '404':              '404 - Page Not Found | AHOY VPN',
  'admin':            'Admin | AHOY VPN',
  'affiliate':        'Affiliate Program | AHOY VPN',
  'affiliate-agreement': 'Affiliate Agreement | AHOY VPN',
  'affiliate-dashboard': 'Affiliate Dashboard | AHOY VPN',
  'ahoyman':          'Ahoyman | AHOY VPN',
  'ahoyman-dashboard':'Ahoyman Dashboard | AHOY VPN',
  'authorize-redirect': 'Redirecting... | AHOY VPN',
  'checkout':         'Checkout | AHOY VPN',
  'contact':          'Contact Us | AHOY VPN',
  'dashboard':        'Dashboard | AHOY VPN',
  'dns-guide':        'DNS Guide | AHOY VPN',
  'downloads':        'Downloads | AHOY VPN',
  'faq':              'FAQ | AHOY VPN',
  'login':            'Login | AHOY VPN',
  'payment-success':  'Payment Successful | AHOY VPN',
  'privacy':          'Privacy Policy | AHOY VPN',
  'recover':          'Recover Account | AHOY VPN',
  'register':         'Register | AHOY VPN',
  'tos':              'Terms of Service | AHOY VPN',
};

function filenameToKey(filename) {
  // affiliate/[code].html → affiliate
  return filename.replace('.html', '').replace('/[code]', '');
}

function isIndexPage(filename) {
  return filename === 'index.html';
}

// ── Patch a single HTML file ──────────────────────────────────────────────────
function patchPage(filePath, filename) {
  if (!fs.existsSync(filePath)) return;

  let html = fs.readFileSync(filePath, 'utf8');

  // Add security headers before </head>
  if (!html.includes('X-Frame-Options')) {
    html = html.replace('</head>', securityHeaders + '</head>', 1);
  }

  // Add favicon/apple-touch-icon if missing
  if (!html.includes('rel="icon"') && !html.includes('favicon.ico')) {
    html = html.replace('<head>', '<head>' + faviconLink + appleTouchIcon, 1);
  }

  // Index-specific SEO: title, JSON-LD, hidden H1
  if (isIndexPage(filename)) {
    if (!html.includes('<title>')) {
      html = html.replace('<head>', `<head><title>${indexTitle}</title>`, 1);
    }
    if (!html.includes('application/ld+json')) {
      html = html.replace('</head>', indexJsonLd + '</head>', 1);
    }
    if (!html.includes('data-seo-h1')) {
      html = html.replace('<div id="__next">', '<div id="__next">' + hiddenH1, 1);
    }
  } else {
    // Add <title> for non-index pages if missing
    const key = filenameToKey(filename);
    const title = pageTitles[key] || `${key} | AHOY VPN`;
    if (!html.includes('<title>')) {
      html = html.replace('<head>', `<head><title>${title}</title>`, 1);
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