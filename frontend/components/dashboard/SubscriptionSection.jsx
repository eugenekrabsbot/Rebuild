// SubscriptionSection component - renders subscription status card with plan selection or active subscription details.
// Extracted from dashboard.jsx to enable component decomposition.
import { useState } from 'react';
import { useRouter } from 'next/router';
import Card from '../ui/Card';
import Button from '../ui/Button';
import PlanCard from './PlanCard';
import styles from './styles.js';

// Plans data — mirrors the plans from backend /api/payment/plans
// Kept in sync with backend plans:
//   monthly: $5.99/mo, quarterly: $16.99/3mo, semi-annual: $31.99/6mo, annual: $59.99/yr
const PLANS = [
  {
    id: 'monthly',
    name: 'Monthly',
    price: '$5.99',
    period: '/month + tax',
    description: 'Perfect for trying AHOY VPN',
    features: ['10 simultaneous connections', '50+ server locations', '24/7 support'],
    cryptoOnly: false,
  },
  {
    id: 'quarterly',
    name: 'Quarterly',
    price: '$16.99',
    period: '/3 months + tax',
    description: 'Great value, save a bit',
    features: ['10 simultaneous connections', '50+ server locations', '24/7 support', 'Save 5%'],
    highlight: true,
    cryptoOnly: false,
  },
  {
    id: 'semiannual',
    name: 'Semi-Annual',
    price: '$31.99',
    period: '/6 months + tax',
    description: 'Best savings',
    features: ['10 simultaneous connections', '50+ server locations', '24/7 support', 'Save 10%'],
    cryptoOnly: true,
  },
  {
    id: 'annual',
    name: 'Annual',
    price: '$59.99',
    period: '/year + tax',
    description: 'Ultimate savings',
    features: ['10 simultaneous connections', '50+ server locations', '24/7 support', 'Save 15%'],
    cryptoOnly: true,
  },
];

function SubscriptionSection({ subscription, paymentMethod, onCancel }) {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState(null);

  const handlePurchase = (plan) => {
    setSelectedPlan(plan);
    router.push(`/checkout?plan=${plan.id}&method=${paymentMethod}`);
  };

  if (subscription) {
    return (
      <Card style={styles.card}>
        <h2>Subscription Status</h2>
        <div>
          <p><strong>Plan:</strong> {subscription.planName}</p>
          <p><strong>Status:</strong> {subscription.status}</p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {subscription.hasCardSubscription && (
              <Button
                onClick={() => window.open('/api/customer/me/update-payment', '_self')}
                style={{ background: '#2E7D32', flex: '1', minWidth: '140px' }}
              >
                Update Card
              </Button>
            )}
            <Button onClick={onCancel} style={styles.cancelButton}>
              Cancel Subscription
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <h2>Subscription Status</h2>
      <p style={{ marginBottom: '1rem' }}>No active subscription. Choose a plan below to get started.</p>
      <div style={styles.plansGrid}>
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            onSelect={() => handlePurchase(plan)}
            selected={selectedPlan?.id === plan.id}
          />
        ))}
      </div>
    </Card>
  );
}

export default SubscriptionSection;
