import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RolloutSlider } from '../RolloutSlider.js';

/**
 * Discovered during D8's cross-cutting a11y pass (row 64): `onKeyUp={commit}`
 * fired unconditionally on ANY keyup while the slider had focus — including
 * the Tab key's own keyup, which real browsers deliver to whichever element
 * currently holds focus. A keyboard-only operator who merely Tabbed INTO a
 * production rollout slider (never touching its value) would trigger a real
 * mutation-confirmation dialog with no intent to change anything.
 */
describe('RolloutSlider — commit only fires on an actual value change', () => {
  it('does not call onCommit when keyup fires but the draft still equals the committed value (e.g. Tab landing on the slider)', () => {
    const onCommit = vi.fn();
    render(
      <RolloutSlider id="rollout" label="Rollout percentage" value={20} onCommit={onCommit} />,
    );

    const slider = screen.getByLabelText('Rollout percentage');
    fireEvent.keyUp(slider, { key: 'Tab' });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not call onCommit on a mouseUp with no preceding value change', () => {
    const onCommit = vi.fn();
    render(
      <RolloutSlider id="rollout" label="Rollout percentage" value={20} onCommit={onCommit} />,
    );

    const slider = screen.getByLabelText('Rollout percentage');
    fireEvent.mouseUp(slider);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('still calls onCommit with the new value once the value actually changes before keyup', () => {
    const onCommit = vi.fn();
    render(
      <RolloutSlider id="rollout" label="Rollout percentage" value={20} onCommit={onCommit} />,
    );

    const slider = screen.getByLabelText('Rollout percentage');
    fireEvent.change(slider, { target: { value: '35' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(35);
  });

  it('still calls onCommit with the new value once the value actually changes before mouseUp', () => {
    const onCommit = vi.fn();
    render(
      <RolloutSlider id="rollout" label="Rollout percentage" value={20} onCommit={onCommit} />,
    );

    const slider = screen.getByLabelText('Rollout percentage');
    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.mouseUp(slider);

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(60);
  });
});
