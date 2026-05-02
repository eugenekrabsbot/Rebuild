import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Metadata */}
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="AHOY VPN - Privacy-first VPN service with zero logs and no tracking. Fast, secure, and affordable." />
        <meta name="keywords" content="VPN, privacy, secure, no logs, anonymous, encryption" />
        <meta name="author" content="AHOY VPN" />
        <meta name="theme-color" content="#0F0F0F" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://ahoyvpn.net" />
        <meta property="og:title" content="AHOY VPN - Privacy-First VPN Service" />
        <meta property="og:description" content="Secure your internet connection with military-grade encryption. Zero logs, no tracking, no compromises." />
        <meta property="og:image" content="https://ahoyvpn.net/og-image.png" />

        {/* Twitter Card */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content="https://ahoyvpn.net" />
        <meta property="twitter:title" content="AHOY VPN - Privacy-First VPN Service" />
        <meta property="twitter:description" content="Secure your internet connection with military-grade encryption." />
        <meta property="twitter:image" content="https://ahoyvpn.net/og-image.png" />

        {/* Canonical */}
        <link rel="canonical" href="https://ahoyvpn.net" />

        {/* Icons */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Fonts (optional - if using external fonts) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* Note: Per-page <Head> in next/head defines each page's <title>.
            Defining a default <title> here would cause ESLint's
            @next/next/no-title-in-document-head rule to fire. The canonical
            default is set per-page in each pages/*.jsx file. */}

        {/* Security Headers — managed by nginx, not meta tags */}
      </Head>

      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}