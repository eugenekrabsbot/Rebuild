// Update Payment page — Authorize.net return URL.
// When a customer updates their card, Authorize.net redirects them here.
// Shows a success message and redirects to dashboard.

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function UpdatePayment() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to dashboard after showing the message briefly
    const timer = setTimeout(() => {
      router.replace('/dashboard?payment=updated');
    }, 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0F0F0F',
      color: '#F5F5F0',
      fontFamily: 'Inter, system-ui, sans-serif',
      textAlign: 'center',
      padding: '2rem'
    }}>
      {/* Checkmark SVG */}
      <div style={{
        width: '80px',
        height: '80px',
        borderRadius: '50%',
        background: '#1A4D2E',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '1.5rem'
      }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h1 style={{ fontSize: '1.75rem', fontWeight: '700', marginBottom: '0.75rem' }}>
        Payment Method Updated
      </h1>
      <p style={{ color: '#8A8A8A', fontSize: '1rem', maxWidth: '400px', lineHeight: '1.6' }}>
        Your card has been updated on file. Your next billing will reflect the new payment method.
      </p>

      <div style={{ marginTop: '2rem' }}>
        <div style={{
          width: '24px',
          height: '24px',
          border: '2px solid #333',
          borderTopColor: '#4ADE80',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: '#555', fontSize: '0.875rem', marginTop: '0.75rem' }}>
          Redirecting to dashboard...
        </p>
      </div>
    </div>
  );
}