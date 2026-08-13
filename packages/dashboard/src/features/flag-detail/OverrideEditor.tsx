import { useState, type ChangeEvent, type ReactElement } from 'react';
import {
  useVersionedMutation,
  type ConfigRef,
} from '../../api/mutations/use-versioned-mutation.js';
import { Button } from '../../components/atoms/Button.js';
import { TextField } from '../../components/atoms/TextField.js';
import { ConfirmDialog } from '../../components/molecules/ConfirmDialog.js';
import type { Environment } from '../../api/types.js';
import { confirmationFor } from './confirmation-for.js';

export interface OverrideEditorProps {
  readonly flagKey: string;
  readonly environment: Environment;
  readonly overrides: Readonly<Record<string, boolean>>;
}

interface OverrideDraft {
  readonly unitId: string;
  readonly serve: boolean;
}

interface OverridesBody {
  readonly overrides: readonly { readonly unit_id: string; readonly serve: boolean }[];
}

function overridesPath(ref: ConfigRef): string {
  return `/api/flags/${ref.flagKey}/config/${ref.environment}/overrides`;
}

function isValidDrafts(drafts: readonly OverrideDraft[]): boolean {
  const trimmedIds = drafts.map((draft) => draft.unitId.trim());
  if (trimmedIds.some((id) => id.length === 0)) {
    return false;
  }
  return new Set(trimmedIds).size === trimmedIds.length;
}

/**
 * Container (D5): per-unit overrides for one environment, submitted as a
 * whole through `useVersionedMutation` (`PUT .../overrides` replaces the
 * entire set). The read shape is `Record<unitId, serve>` (design D4,
 * `overridesToWire`); the write shape is an array of `{unit_id, serve}`
 * (`replaceOverridesBody`) — converted at the submission boundary, never
 * stored in that shape locally.
 *
 * Save is gated by `confirmationFor` (D5b): production requires confirming a
 * `ConfirmDialog` before the mutation fires; development submits immediately.
 */
export function OverrideEditor({
  flagKey,
  environment,
  overrides,
}: OverrideEditorProps): ReactElement {
  const [drafts, setDrafts] = useState<readonly OverrideDraft[]>(() =>
    Object.entries(overrides).map(([unitId, serve]) => ({ unitId, serve })),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const tier = confirmationFor(environment, 'overrides');
  const mutation = useVersionedMutation<OverridesBody>(
    { flagKey, environment },
    { method: 'PUT', path: overridesPath },
  );

  const save = (): void => {
    mutation.mutate({
      overrides: drafts.map((draft) => ({ unit_id: draft.unitId, serve: draft.serve })),
    });
  };

  const updateDraft = (index: number, patch: Partial<OverrideDraft>): void => {
    setDrafts(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  return (
    <section aria-label={`Overrides — ${environment}`}>
      <h3>Overrides</h3>
      {drafts.map((draft, index) => (
        // Index as key is deliberate: rows have no stable id besides the
        // unit id itself, which is exactly the field being edited.
        <div key={index} role="group" aria-label={`Override ${index + 1}`}>
          <TextField
            id={`override-unit-id-${index}`}
            label={`Unit ID — override ${index + 1}`}
            value={draft.unitId}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              updateDraft(index, { unitId: event.target.value });
            }}
          />
          <label htmlFor={`override-serve-${index}`}>{`Serve — override ${index + 1}`}</label>
          <input
            id={`override-serve-${index}`}
            type="checkbox"
            checked={draft.serve}
            onChange={(event) => {
              updateDraft(index, { serve: event.target.checked });
            }}
          />
          <Button
            onClick={() => {
              setDrafts(drafts.filter((_, i) => i !== index));
            }}
          >
            {`Remove override ${index + 1}`}
          </Button>
        </div>
      ))}
      <Button
        onClick={() => {
          setDrafts([...drafts, { unitId: '', serve: true }]);
        }}
      >
        Add override
      </Button>
      <Button
        disabled={!isValidDrafts(drafts)}
        onClick={() => {
          if (tier === 'none') {
            save();
          } else {
            setConfirmOpen(true);
          }
        }}
      >
        Save overrides
      </Button>
      {mutation.isError ? <p role="alert">Failed to save overrides.</p> : null}
      <ConfirmDialog
        open={confirmOpen}
        flagKey={flagKey}
        environment={environment}
        targetStateLabel={`${drafts.length} override(s)`}
        onConfirm={() => {
          save();
          setConfirmOpen(false);
        }}
        onCancel={() => {
          setConfirmOpen(false);
        }}
      />
    </section>
  );
}
