import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { TypeToConfirmDialog } from '../TypeToConfirmDialog.js';

interface HarnessProps {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Wires `open` the way a real container would: `onCancel` actually closes it. */
function Harness({ onConfirm, onCancel }: HarnessProps): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <TypeToConfirmDialog
      open={open}
      flagKey="checkout-v2"
      environment="production"
      targetStateLabel="disabled"
      onConfirm={onConfirm}
      onCancel={() => {
        setOpen(false);
        onCancel();
      }}
    />
  );
}

describe('TypeToConfirmDialog — production kill switch (rows 57, 58)', () => {
  it('keeps confirm disabled until the typed text exactly matches the flag key', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <TypeToConfirmDialog
        open
        flagKey="checkout-v2"
        environment="production"
        targetStateLabel="disabled"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Type "checkout-v2" to confirm');
    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmButton).toBeDisabled();

    await user.type(input, 'checkout');
    expect(confirmButton).toBeDisabled();
    await user.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(input, '-v3');
    expect(confirmButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'checkout-v2');
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('is a labelled modal dialog; Escape closes without confirming and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    trigger.textContent = 'Disable';
    document.body.append(trigger);
    trigger.focus();

    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName();

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    trigger.remove();
  });

  it('clears any previously typed text when the dialog reopens', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TypeToConfirmDialog
        open
        flagKey="checkout-v2"
        environment="production"
        targetStateLabel="disabled"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Type "checkout-v2" to confirm'), 'wrong');
    expect(screen.getByLabelText('Type "checkout-v2" to confirm')).toHaveValue('wrong');

    rerender(
      <TypeToConfirmDialog
        open={false}
        flagKey="checkout-v2"
        environment="production"
        targetStateLabel="disabled"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <TypeToConfirmDialog
        open
        flagKey="checkout-v2"
        environment="production"
        targetStateLabel="disabled"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Type "checkout-v2" to confirm')).toHaveValue('');
  });
});
