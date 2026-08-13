import type { ReactElement } from 'react';
import { Button } from '../atoms/Button.js';
import type { Environment } from '../../api/types.js';
import { useDialogLifecycle } from './use-dialog-lifecycle.js';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly flagKey: string;
  readonly environment: Environment;
  readonly targetStateLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Presentational (D4b): the simple modal for production rollout/rules/
 * overrides changes (spec: "Production rollout/rules/overrides show a
 * simple modal" — flag key, environment, target state). Ignorant of
 * mutations: the container decides what confirming does.
 */
export function ConfirmDialog({
  open,
  flagKey,
  environment,
  targetStateLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement | null {
  const dialogRef = useDialogLifecycle(open, onCancel);
  const titleId = `confirm-dialog-title-${flagKey}-${environment}`;

  if (!open) {
    return null;
  }

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId}>Confirm this change</h2>
      <p>Flag: {flagKey}</p>
      <p>Environment: {environment}</p>
      <p>Target state: {targetStateLabel}</p>
      <Button onClick={onConfirm}>Confirm</Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  );
}
