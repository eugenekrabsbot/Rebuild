import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Card } from '../components/ui';
import { Button } from '../components/ui';
import { FormGroup, Input } from '../components/ui';
import api from '../api/client';

export default function Register() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setAccountNumber('');

    if (!password || !confirmPassword) {
      setError('Both password fields are required');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const response = await api.register(password, confirmPassword);
      const acct = response?.data?.user?.accountNumber;

      if (acct) {
        setAccountNumber(acct);
        setSuccess(`Registration successful. Your account number is ${acct}. Save it now.`);
        if (typeof window !== 'undefined') {
          localStorage.setItem('lastAccountNumber', acct);
        }
      } else {
        setSuccess('Registration successful. Please log in and verify your account number in the dashboard.');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <Card style={styles.card}>
        <h1 style={styles.title}>Create Account</h1>
        <p style={styles.subtitle}>Set your password to generate your AhoyVPN account number</p>

        <form onSubmit={handleSubmit}>
          <FormGroup label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={loading}
              required
            />
          </FormGroup>

          <FormGroup label="Confirm Password">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              disabled={loading}
              required
            />
          </FormGroup>

          <p style={styles.passwordNote}>
            Password must be at least 12 characters long and contain both letters and numbers.
          </p>

          {error && <p style={styles.error}>{error}</p>}
          {success && <p style={styles.success}>{success}</p>}

          {accountNumber && (
            <div style={styles.accountNumberBox}>
              <div>
                <span style={{ fontWeight: 700 }}>Account Number:</span>{' '}
                <span style={{ fontFamily: 'monospace', fontSize: '1rem' }}>{accountNumber}</span>
              </div>
              <Button
                variant="secondary"
                style={styles.copyButton}
                onClick={() => navigator.clipboard.writeText(accountNumber)}
              >
                Copy
              </Button>
            </div>
          )}

          {accountNumber ? (
            <Button
              type="button"
              fullWidth
              onClick={() => router.push('/login')}
            >
              Continue to Login
            </Button>
          ) : (
            <Button type="submit" fullWidth disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </Button>
          )}
        </form>

        {/* Signup Process memo — below the form, less intimidating */}
        <Card style={styles.explanationCard}>
          <p style={styles.explanationText}>
            <strong>Signup Process:</strong><br/><br/>
            Upon setting your password, we will provide you with a unique user ID. Please save this user ID, then log in using your ID and password. Proceed to generate a recovery kit and purchase a subscription with cryptocurrency.<br/><br/>
            Please allow one to two minutes for the payment form to process your transaction. If your VPN client credentials do not appear instantly on your dashboard, please wait an additional 15–30 minutes. If you still do not see the credentials after that time, contact William at ahoyvpn@ahoyvpn.net for assistance.
          </p>
        </Card>

        <Card style={styles.infoCard}>
          <p style={styles.infoText}>
            Your account number is your permanent login identifier. Save it securely after registration.
          </p>
        </Card>

        <Card style={styles.loginCard}>
          <p style={styles.loginText}>
            Already have an account?{' '}
            <Link href="/login" style={styles.loginLink}>
              Sign in
            </Link>
          </p>
        </Card>
      </Card>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '520px',
    margin: '2rem auto',
    padding: '0 1rem',
  },
  card: {
    padding: '2rem',
  },
  title: {
    marginBottom: '0.5rem',
  },
  subtitle: {
    color: '#B0C4DE',
    marginBottom: '1.5rem',
  },
  explanationCard: {
    backgroundColor: 'rgba(30, 144, 255, 0.1)',
    border: '1px solid rgba(30, 144, 255, 0.3)',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
  },
  explanationText: {
    color: '#B0C4DE',
    fontSize: '0.9rem',
    lineHeight: 1.6,
  },
  error: {
    color: '#ff6b6b',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    padding: '0.75rem',
    borderRadius: '4px',
    marginBottom: '0.75rem',
    fontSize: '0.9rem',
  },
  success: {
    color: '#4CAF50',
    backgroundColor: 'rgba(76, 175, 80, 0.12)',
    padding: '0.75rem',
    borderRadius: '4px',
    marginBottom: '0.75rem',
    fontSize: '0.9rem',
  },
  accountNumberBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    backgroundColor: 'rgba(30, 144, 255, 0.1)',
    border: '1px solid rgba(30, 144, 255, 0.35)',
    borderRadius: '8px',
    padding: '0.75rem',
    marginBottom: '1rem',
  },
  copyButton: {
    padding: '0.35rem 0.7rem',
    minWidth: '76px',
  },
  passwordNote: {
    color: '#B0C4DE',
    fontSize: '0.85rem',
    marginTop: '-0.5rem',
    marginBottom: '1rem',
    lineHeight: 1.4,
  },
  infoCard: {
    backgroundColor: 'rgba(30, 144, 255, 0.05)',
    borderColor: 'rgba(30, 144, 255, 0.2)',
    marginTop: '1.5rem',
  },
  infoText: {
    color: '#B0C4DE',
    fontSize: '0.9rem',
    lineHeight: 1.6,
  },
  loginCard: {
    textAlign: 'center',
    marginTop: '1.5rem',
  },
  loginText: {
    color: '#B0C4DE',
    fontSize: '0.95rem',
  },
  loginLink: {
    color: '#1E90FF',
    textDecoration: 'none',
  },
};
