import { useEffect } from 'react';
import Head from 'next/head';

export default function DNSGuide() {
  useEffect(() => {
    window.location.replace('https://ahoyvpn.com');
  }, []);

  return (
    <>
      <Head>
        <title>Redirecting...</title>
        <meta httpEquiv="refresh" content="0;url=https://ahoyvpn.com" />
      </Head>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0F0F0F', color: '#8A8A8A', fontFamily: 'sans-serif' }}>
        <p>Redirecting to <a href="https://ahoyvpn.com" style={{ color: '#3B82F6' }}>ahoyvpn.com</a>...</p>
      </div>
    </>
  );
}
