import Card from '../ui/Card';
import Button from '../ui/Button';

export default function PlanSelector({ plans, selectedPlan, onSelect }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {plans.map((plan) => {
        const isSelected = plan.id === selectedPlan;
        return (
          <Card
            key={plan.id}
            data-plan-id={plan.id}
            style={{
              borderColor: isSelected ? '#1E90FF' : '#444',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ color: '#1E90FF', marginBottom: '0.25rem' }}>{plan.name}</h3>
                <p style={{ color: '#B0C4DE', fontSize: '1.25rem', fontWeight: 'bold' }}>
                  {plan.price}
                  <span style={{ fontSize: '0.9rem', fontWeight: 'normal', color: '#888' }}>
                    {plan.period}
                  </span>
                </p>

              </div>
              <Button
                onClick={() => onSelect(plan.id)}
                variant={isSelected ? 'primary' : 'secondary'}
                size="md"
              >
                {isSelected ? 'Selected' : 'Select'}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
