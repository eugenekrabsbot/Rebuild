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

// 4. Inject social footer links before </body> so they're visible in raw HTML
//    (Next.js static export doesn't render the page footer in the static HTML shell)
const socialLinksHtml = `
<footer id="site-footer" style="background:#0F0F0F;border-top:1px solid #222;padding:2rem;text-align:center;">
  <div style="display:flex;gap:2rem;justify-content:center;align-items:center;margin-bottom:1rem;">
    <a href="https://x.com/AhoyVPN" target="_blank" rel="noopener noreferrer" style="color:#8A8A8A;text-decoration:none;font-size:0.875rem;display:flex;align-items:center;gap:0.4rem;transition:color 0.2s;" aria-label="Follow AhoyVPN on X">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      X / Twitter
    </a>
    <a href="https://www.instagram.com/ahoy_vpn/" target="_blank" rel="noopener noreferrer" style="color:#8A8A8A;text-decoration:none;font-size:0.875rem;display:flex;align-items:center;gap:0.4rem;transition:color 0.2s;" aria-label="Follow AhoyVPN on Instagram">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
      Instagram
    </a>
    <a href="https://www.facebook.com/AhoyVPN" target="_blank" rel="noopener noreferrer" style="color:#8A8A8A;text-decoration:none;font-size:0.875rem;display:flex;align-items:center;gap:0.4rem;transition:color 0.2s;" aria-label="Follow AhoyVPN on Facebook">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
      Facebook
    </a>
  </div>
  <p style="color:#5A5A5A;font-size:0.8rem;margin:0;">© ${new Date().getFullYear()} AhoyVPN. All rights reserved.</p>
</footer>
`;
if (!html.includes('id="site-footer"')) {
  html = html.replace('</body>', socialLinksHtml + '</body>', 1);
}

fs.writeFileSync(INDEX, html, 'utf8');
console.log('postbuild.js: patched index.html — title, JSON-LD, H1, and social footer injected');