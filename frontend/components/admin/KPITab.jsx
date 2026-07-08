// frontend/components/admin/KPITab.jsx
// KPI tab — renders metrics grid, payment split bar, and system notes.
//
// WHY THIS EXISTS:
// Isolates KPI rendering logic from admin page orchestration.
// Enables independent testing of KPI display logic and prevents the
// admin page from growing unbounded as more tabs are added.
//
// PROPS:
//   - metrics: object with { totalCustomers, activeSubscriptions, mrr }
//     (shape matches adminController.getAdminMetrics() response)

import React from 'react';
import Card from '../ui/Card';
import KPICard from './KPICard';
import styles from './styles';

export default function KPITab({ metrics }) {
  return (
    <div style={styles.content}>
      {/* KPI Metric Cards */}
      <div style={styles.kpisGrid}>
        <KPICard label="Total Customers" value={metrics.totalCustomers} />
        <KPICard label="Active Subscriptions" value={metrics.activeSubscriptions} />
        <KPICard
          label="Monthly Recurring Revenue"
          value={`$${metrics.mrr.toFixed(2)}`}
        />
      </div>

      {/* Payment Method Split */}
      <Card title="Payment Method Mix" style={{ marginBottom: '2rem' }}>
        <div style={styles.paymentSplit}>
          <div style={styles.splitItem}>
            <div style={styles.splitLabel}>Cryptocurrency</div>
            <div style={styles.splitBar}>
              <div
                style={{
                  ...styles.splitFill,
                  width: '100%',
                }}
              />
            </div>
            <div style={styles.splitPercent}>100%</div>
          </div>
        </div>
      </Card>

      {/* System Notes */}
      <Card title="System Notes">
        <ul style={styles.notesList}>
          <li>MRR is calculated from active subscriptions only</li>
          <li>Crypto includes Bitcoin and other cryptocurrencies via Plisio</li>
          <li>All customer payments are crypto-only via Plisio</li>
          <li>Metrics update in real-time as subscriptions change</li>
        </ul>
      </Card>
    </div>
  );
}
