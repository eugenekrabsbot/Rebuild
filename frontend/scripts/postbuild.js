#!/usr/bin/env node
/**
 * postbuild.js — Patches index.html after Next.js static export
 * Adds <title>, <h1> and JSON-LD to the raw HTML so crawlers see them
 * even before React hydrates.
 */
const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'out', 'index.html');
const title = 'AHOY VPN - Privacy-First VPN. Zero Logs, Military-Grade Encryption';
const description = 'AhoyVPN is a privacy-first VPN with zero logs, military-grade encryption, and no email required. Starting at $5.99/month with up to 10 simultaneous connections.';
const h1 = 'Your internet. Your rules.';
const jsonLd = {
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
};

if (!fs.existsSync(INDEX)) {
  console.error('postbuild.js: index.html not found at', INDEX);
  process.exit(1);
}

let html = fs.readFileSync(INDEX, 'utf8');

// 1. Inject <title> right after <head>
if (!html.includes('<title>')) {
  html = html.replace('<head>', `<head><title>${title}</title>`, 1);
}

// 2. Inject JSON-LD before </head>
if (!html.includes('application/ld+json')) {
  const ldJsonScript = `<script type="application/ld+json">${JSON.stringify(jsonLd, null, 0)}</script>`;
  html = html.replace('</head>', `${ldJsonScript}</head>`, 1);
}

// 3. Inject <h1> into the loading spinner's <p> tag — transforms the loading text into the H1
//    This makes the H1 visible in raw HTML for crawlers
if (!html.includes('<h1')) {
  // Replace the loading <p> with an H1
  html = html.replace(
    '<p style="color:#8A8A8A;margin-top:1rem;font-size:0.9rem">Loading...</p>',
    `<h1 style="color:#fff;margin-top:1rem;font-size:1.2rem;font-weight:700">${h1}</h1>`
  );
}

fs.writeFileSync(INDEX, html, 'utf8');
console.log('postbuild.js: patched index.html — title, JSON-LD, and H1 injected');
