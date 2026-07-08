import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import '../styles/globals.css';
import Layout from '../components/Layout';
import { checkAndSetAffiliateFromUrl } from '../lib/cookies';

export const AuthContext = React.createContext();

export default function App({ Component, pageProps }) {
  const [auth, setAuth] = useState({ isLoggedIn: false, user: null, role: 'public', token: null });
  const [isLoading, setIsLoading] = useState(true);

  const cspHeader = `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com; connect-src 'self' https://checkout.plisio.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self';`.replace(/\s+/g, ' ').trim();

  useEffect(() => {
    try { checkAndSetAffiliateFromUrl(); } catch (e) { console.warn('Failed to check affiliate URL:', e); }
    try {
      const token = localStorage.getItem('authToken');
      const userRole = localStorage.getItem('userRole');
      const userData = localStorage.getItem('userData');
      if (token) setAuth({ isLoggedIn: true, user: userData ? JSON.parse(userData) : null, role: userRole || 'customer', token });
    } catch (e) { console.warn('Failed to access localStorage:', e); }
    setIsLoading(false);
  }, []);

  const login = (userData, token, role = 'customer') => {
    try { localStorage.setItem('authToken', token); localStorage.setItem('userRole', role); localStorage.setItem('userData', JSON.stringify(userData)); } catch (e) { console.warn('Failed to save auth:', e); }
    setAuth({ isLoggedIn: true, user: userData, role, token });
  };
  const logout = () => {
    try { localStorage.removeItem('authToken'); localStorage.removeItem('userRole'); localStorage.removeItem('userData'); } catch (e) { console.warn('Failed to remove auth:', e); }
    setAuth({ isLoggedIn: false, user: null, role: 'public', token: null });
  };

  if (isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0F0F0F' }}>
      <div style={{ textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/AhoyMonthly_transparent.png?v=3" alt="AHOY VPN Logo" width="110" height="36" style={{ height: '2.5em', verticalAlign: 'middle', aspectRatio: '55/18', objectFit: 'contain' }} />
        <p style={{ color: '#8A8A8A', marginTop: '1rem', fontSize: '0.9rem' }}>Loading...</p>
      </div>
    </div>
  );

  return (
    <>
      <Head>
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </Head>
      <AuthContext.Provider value={{ ...auth, login, logout }}>
        <Layout><Component {...pageProps} /></Layout>
      </AuthContext.Provider>
    </>
  );
}
