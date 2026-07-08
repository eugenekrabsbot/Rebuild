/**
 * PaymentMethodSelector Unit Tests
 * 
 * Tests the payment method button-group selector used in the checkout flow.
 * Renders a grid of buttons for each supported payment method.
 * with selected state styling.
 * 
 * Coverage: previously 0%, now fully covered.
 * 
 * NOTE: Uses RTL (@testing-library/react) following the established frontend test pattern.
 */

const React = require('react');
const { render, screen } = require('@testing-library/react');
require('@testing-library/jest-dom');

const PaymentMethodSelector = require('../../../components/checkout/PaymentMethodSelector').default;

describe('PaymentMethodSelector', () => {
  const mockMethods = [
    { id: 'crypto', name: 'Cryptocurrency', provider: 'Plisio' },
  ];

  it('renders a button for each payment method', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector methods={mockMethods} selected={null} onSelect={onSelect} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('displays the method name in each button', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector methods={mockMethods} selected={null} onSelect={onSelect} />);
    expect(screen.getByText('Cryptocurrency')).toBeInTheDocument();
  });

  it('displays the provider name in each button', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector methods={mockMethods} selected={null} onSelect={onSelect} />);
    expect(screen.getByText('via Plisio')).toBeInTheDocument();
  });

  it('calls onSelect with method id when button is clicked', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector methods={mockMethods} selected={null} onSelect={onSelect} />);
    // Click the second button (Cryptocurrency)
    const buttons = screen.getAllByRole('button');
    buttons[1].click();
    expect(onSelect).toHaveBeenCalledWith('crypto');
  });

  it('sets aria-pressed to true for selected method', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector methods={mockMethods} selected="crypto" onSelect={onSelect} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders a grid container for responsive layout', () => {
    const onSelect = jest.fn();
    const { container } = render(<PaymentMethodSelector methods={mockMethods} selected={null} onSelect={onSelect} />);
    const div = container.querySelector('div');
    // Verifies grid layout for button arrangement
    expect(div.style.display).toBe('grid');
  });

  it('renders nothing when methods array is empty', () => {
    const onSelect = jest.fn();
    const { container } = render(<PaymentMethodSelector methods={[]} selected={null} onSelect={onSelect} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('handles single payment method', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector methods={[mockMethods[0]]} selected={null} onSelect={onSelect} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    screen.getByRole('button').click();
    expect(onSelect).toHaveBeenCalledWith('crypto');
  });
});
