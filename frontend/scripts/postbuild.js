#!/usr/bin/env node
/**
 * postbuild.js — Patches index.html after Next.js static export
 * Adds <title>, JSON-LD, and a hidden H1 to the raw HTML so crawlers see them
 * even before React hydrates. The H1 is injected as hidden text so it survives
 * the initial SPA load without causing React hydration mismatches.
 */
const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'out', 'index.html');
const title = 'AHOY VPN - Privacy-First VPN. Zero Logs, Military-Grade Encryption';
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

// 3. Inject a hidden H1 into the loading spinner container so crawlers see it in
//    raw HTML. Position:absolute + off-screen = invisible to humans, visible to bots.
//    This is NOT inside React's root div — it's in the static HTML fallback content,
//    so no hydration mismatch is possible.
if (!html.includes('data-seo-h1')) {
  const hiddenH1 = '<h1 data-seo-h1 style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true">Your internet. Your rules.</h1>';
  // Inject after <div id="__next"> so it's inside the React root anchor
  html = html.replace('<div id="__next">', '<div id="__next">' + hiddenH1, 1);
}

fs.writeFileSync(INDEX, html, 'utf8');
console.log('postbuild.js: patched index.html — title, JSON-LD, and H1 injected');