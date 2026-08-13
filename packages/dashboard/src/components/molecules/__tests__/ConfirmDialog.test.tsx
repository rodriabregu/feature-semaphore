import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { ConfirmDialog } from '../ConfirmDialog.js';

interface HarnessProps {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Wires `open` the way a real container would: `onCancel` actually closes it. */
function Harness({ onConfirm, onCancel }: HarnessProps): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      flagKey="checkout-v2"
      environment="production"
      targetStateLabel="rollout 20% → 35%"
      onConfirm={onConfirm}
      onCancel={() => {
        setOpen(false);
        onCancel();
      }}
    />
  );
}

describe('ConfirmDialog — production rollout/rules/overrides modal (row 58)', () => {
  it('renders the flag key, environment, and target state', () => {
    render(
      <ConfirmDialog
        open
        flagKey="checkout-v2"
        environment="production"
        targetStateLabel="rollout 20% → 35%"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/checkout-v2/)).toBeInTheDocument();
    expect(screen.getByText(/production/)).toBeInTheDocument();
    expect(screen.getByText(/rollout 20% → 35%/)).toBeInTheDocument();
  });

  it('is a labelled modal dialog', () => {
    render(
      <ConfirmDialog
        open
        flagKey="checkout-v2"
        environment="production"
        targetStateLabel="rollout 20% → 35%"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName();
  });

  it('Escape closes without confirming and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    trigger.textContent = 'Change rollout';
    document.body.append(trigger);
    trigger.focus();

    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    trigger.remove();
  });

  it('confirming calls onConfirm exactly once', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
