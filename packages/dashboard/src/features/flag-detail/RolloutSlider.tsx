import { useState, type ChangeEvent, type ReactElement } from 'react';

export interface RolloutSliderProps {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** Fires once the operator commits the change, not on every drag tick. */
  readonly onCommit: (value: number) => void;
}

/**
 * Presentational (D4a): a labelled 0-100 range input, ignorant of mutations.
 * Tracks a local draft while dragging so the thumb feels responsive, and
 * re-syncs to `value` whenever the container's own query data changes (e.g.
 * after a successful mutation's invalidate + refetch) — computed during
 * render (React's "adjusting state when a prop changes" pattern) rather than
 * in an effect, which would cause an extra, avoidable render pass.
 */
export function RolloutSlider({ id, label, value, onCommit }: RolloutSliderProps): ReactElement {
  const [priorValue, setPriorValue] = useState(value);
  const [draft, setDraft] = useState(value);

  if (value !== priorValue) {
    setPriorValue(value);
    setDraft(value);
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraft(Number(event.target.value));
  };

  const commit = (): void => {
    onCommit(draft);
  };

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={draft}
        onChange={handleChange}
        onMouseUp={commit}
        onKeyUp={commit}
      />
      <output htmlFor={id}>{draft}%</output>
    </div>
  );
}
