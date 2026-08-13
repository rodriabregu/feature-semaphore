import { useState, type ChangeEvent, type ReactElement } from 'react';
import { Button } from '../atoms/Button.js';
import { TextField } from '../atoms/TextField.js';
import type { Environment } from '../../api/types.js';
import { useDialogLifecycle } from './use-dialog-lifecycle.js';

export interface TypeToConfirmDialogProps {
  readonly open: boolean;
  readonly flagKey: string;
  readonly environment: Environment;
  readonly targetStateLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Presentational (D4b): the production kill-switch confirmation (spec:
 * "Production kill switch requires typing the flag key"). Confirm stays
 * disabled until the typed text exactly (case-sensitively) matches
 * `flagKey` — this is where friction belongs, since the toggle has
 * instantaneous, total blast radius (`#1893`). Ignorant of mutations: the
 * container decides what confirming does.
 */
export function TypeToConfirmDialog({
  open,
  flagKey,
  environment,
  targetStateLabel,
  onConfirm,
  onCancel,
}: TypeToConfirmDialogProps): ReactElement | null {
  const dialogRef = useDialogLifecycle(open, onCancel);
  const [typed, setTyped] = useState('');

  // Render-time reset (RolloutSlider's precedent, D4a): a fresh open must
  // never inherit a previous confirmation's typed text.
  const [priorOpen, setPriorOpen] = useState(open);
  if (open !== priorOpen) {
    setPriorOpen(open);
    if (open) {
      setTyped('');
    }
  }

  const titleId = `type-to-confirm-title-${flagKey}-${environment}`;
  const inputId = `type-to-confirm-input-${flagKey}-${environment}`;
  const matches = typed === flagKey;

  if (!open) {
    return null;
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setTyped(event.target.value);
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId}>Type the flag key to confirm</h2>
      <p>Flag: {flagKey}</p>
      <p>Environment: {environment}</p>
      <p>Target state: {targetStateLabel}</p>
      <TextField
        id={inputId}
        label={`Type "${flagKey}" to confirm`}
        value={typed}
        onChange={handleChange}
      />
      <Button
        onClick={() => {
          if (matches) onConfirm();
        }}
        disabled={!matches}
      >
        Confirm
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  );
}
