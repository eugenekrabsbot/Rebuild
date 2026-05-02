import React, { useContext } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Image from 'next/image';
import { AuthContext } from '../pages/_app';

export default function Layout({ children }) {
  const auth = useContext(AuthContext);
  return (
    <div style={styles.container}>
      <Header auth={auth} />
      <main style={styles.main}>{children}</main>
      <Footer />
      <Link href="/contact" style={styles.floatingSupportButton} aria-label="Contact support">Contact Support</Link>
    </div>
  );
}

function Header({ auth }) {
  const router = useRouter();

  return (
    <>
      <header style={styles.header} className="ahoy-header">
        <div style={styles.headerContent} className="ahoy-headerContent">
          <div style={styles.logo}>
            <Link href="/" passHref>
              <a style={styles.logoLink}>
                <Image src="/AhoyMonthly_transparent.png?v=3" alt="AHOY VPN Logo" width={110} height={36}
                  style={{ height: '2.25rem', width: 'auto', verticalAlign: 'middle', marginRight: '0.5rem' }} />
                <span style={styles.logoText}>AHOY VPN</span>
              </a>
            </Link>
          </div>
          <nav style={styles.nav} className="ahoy-nav" aria-label="Main navigation">
            <Link href="/" passHref><a style={styles.navLink} className={router.pathname === '/' ? 'ahoy-nav-link-active' : ''}>Home</a></Link>
            <Link href="/faq" passHref><a style={styles.navLink} className={router.pathname === '/faq' ? 'ahoy-nav-link-active' : ''}>FAQ</a></Link>
            <Link href="/downloads" passHref><a style={styles.navLink} className={router.pathname === '/downloads' ? 'ahoy-nav-link-active' : ''}>Downloads</a></Link>
            <Link href="/privacy" passHref><a style={styles.navLink} className={router.pathname === '/privacy' ? 'ahoy-nav-link-active' : ''}>Privacy</a></Link>
            <Link href="/tos" passHref><a style={styles.navLink} className={router.pathname === '/tos' ? 'ahoy-nav-link-active' : ''}>Terms</a></Link>
            {auth?.isLoggedIn ? (
              <>
                {auth.role === 'customer' && <Link href="/dashboard" passHref><a style={styles.navLink} className={router.pathname === '/dashboard' ? 'ahoy-nav-link-active' : ''}>Dashboard</a></Link>}
                {auth.role === 'affiliate' && <Link href="/affiliate" passHref><a style={styles.navLink} className={router.pathname.startsWith('/affiliate') ? 'ahoy-nav-link-active' : ''}>Affiliate</a></Link>}
                {auth.role === 'admin' && <Link href="/admin" passHref><a style={styles.navLink} className={router.pathname === '/admin' ? 'ahoy-nav-link-active' : ''}>Admin</a></Link>}
                <button style={styles.logoutBtn} onClick={auth.logout} type="button">Sign out</button>
              </>
            ) : (
              <>
                <Link href="/login" passHref><a style={styles.navLink} className={router.pathname === '/login' ? 'ahoy-nav-link-active' : ''}>Sign in</a></Link>

              </>
            )}
          </nav>
        </div>
      </header>
      <style jsx>{`
        .ahoy-nav a:hover:not(.ahoy-cta) { color: #C8C8C8; text-shadow: 0 0 12px rgba(59, 130, 246, 0.5); }
        .ahoy-cta { color: #FFFFFF; }
        .ahoy-cta:hover { background-color: #2563EB; color: #FFFFFF; box-shadow: 0 0 16px rgba(59, 130, 246, 0.6); }
        .ahoy-social-link:hover { color: #F5F5F0; text-shadow: 0 0 8px rgba(59, 130, 246, 0.4); }
        @media (max-width: 768px) {
          .ahoy-headerContent { padding: 0.75rem 1rem !important; flex-direction: column !important; align-items: flex-start !important; gap: 0.75rem !important; }
          .ahoy-nav { flex-wrap: nowrap !important; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; gap: 0.5rem !important; }
          .ahoy-nav::-webkit-scrollbar { display: none; }
          .ahoy-nav a, .ahoy-nav button { white-space: nowrap; font-size: 0.85rem !important; }
        }
      `}</style>
    </>
  );
}

function Footer() {
  return (
    <footer style={styles.footer}>
      <div style={styles.footerContent}>
        <div style={styles.footerSection}>
          <p style={styles.footerBrand}>AHOY VPN</p>
          <p style={styles.footerTagline}>Privacy-first. Zero logs. No compromises.</p>
        </div>
        <div style={styles.footerSection}>
          <p style={styles.footerHeading}>Legal</p>
          <Link href="/tos" passHref><a style={styles.footerLink}>Terms of Service</a></Link>
          <Link href="/privacy" passHref><a style={styles.footerLink}>Privacy Policy</a></Link>
          <Link href="/faq" passHref><a style={styles.footerLink}>FAQ</a></Link>
        </div>
        <div style={styles.footerSection}>
          <p style={styles.footerHeading}>Support</p>
          <Link href="/contact" passHref><a style={styles.footerLink}>Contact Support</a></Link>
          <a href="mailto:ahoyvpn@ahoyvpn.net" style={styles.footerLink}>ahoyvpn@ahoyvpn.net</a>
        </div>
        <div style={styles.footerSection}>
          <p style={styles.footerHeading}>Follow</p>
          <a href="https://x.com/AhoyVPN" target="_blank" rel="noopener noreferrer" style={styles.socialLink} className="ahoy-social-link">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            <span style={{ marginLeft: '0.5rem' }}>X / Twitter</span>
          </a>
        </div>
      </div>
      <div style={styles.footerBottom}>
        <p style={styles.footerCopy}>© 2026 AHOY VPN. All rights reserved.</p>
      </div>
    </footer>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#0F0F0F', color: '#F5F5F0' },
  header: { backgroundColor: '#111111', borderBottom: '1px solid #2E2E2E', position: 'sticky', top: 0, zIndex: 100 },
  headerContent: { maxWidth: '1100px', margin: '0 auto', padding: '0.875rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2rem' },
  logo: { flex: '0 0 auto' },
  logoLink: { display: 'flex', alignItems: 'center', textDecoration: 'none', color: '#F5F5F0' },
  logoText: { fontSize: '1rem', fontWeight: 700, letterSpacing: '0.04em', color: '#F5F5F0' },
  nav: { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1 },
  navLink: { color: '#8A8A8A', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500, transition: 'color 0.2s ease', cursor: 'pointer' },
  ctaBtn: { backgroundColor: '#3B82F6', color: '#FFFFFF', padding: '0.45rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', transition: 'background-color 0.2s ease', display: 'inline-block' },
  logoutBtn: { backgroundColor: 'transparent', color: '#8A8A8A', padding: '0.45rem 0.875rem', borderRadius: '6px', border: '1px solid #2E2E2E', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500, transition: 'all 0.2s ease' },
  main: { flex: 1, maxWidth: '1100px', margin: '0 auto', width: '100%', padding: '2.5rem 1.5rem' },
  footer: { backgroundColor: '#111111', borderTop: '1px solid #2E2E2E', padding: '2.5rem 1.5rem 1.5rem', marginTop: '4rem' },
  footerContent: { maxWidth: '1100px', margin: '0 auto 2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '2.5rem' },
  footerSection: { display: 'flex', flexDirection: 'column', gap: '0.625rem' },
  footerBrand: { fontWeight: 700, fontSize: '0.95rem', color: '#F5F5F0', letterSpacing: '0.04em' },
  footerTagline: { color: '#5A5A5A', fontSize: '0.8rem' },
  footerHeading: { color: '#5A5A5A', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.25rem' },
  footerLink: { color: '#8A8A8A', textDecoration: 'none', fontSize: '0.875rem', transition: 'color 0.2s ease' },
  socialLink: { color: '#8A8A8A', textDecoration: 'none', fontSize: '0.875rem', transition: 'color 0.2s ease', display: 'flex', alignItems: 'center' },
  footerBottom: { borderTop: '1px solid #1E1E1E', paddingTop: '1.5rem', maxWidth: '1100px', margin: '0 auto' },
  footerCopy: { color: '#5A5A5A', fontSize: '0.8rem', textAlign: 'center' },
  floatingSupportButton: { position: 'fixed', right: '20px', bottom: '20px', zIndex: 110, backgroundColor: '#3B82F6', color: '#fff', textDecoration: 'none', padding: '0.625rem 1rem', borderRadius: '999px', boxShadow: '0 4px 16px rgba(59,130,246,0.35)', fontSize: '0.8rem', fontWeight: 600, transition: 'background-color 0.2s ease' },
};
