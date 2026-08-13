import { useState, type ChangeEvent, type ReactElement } from 'react';
import {
  useVersionedMutation,
  type ConfigRef,
} from '../../api/mutations/use-versioned-mutation.js';
import { Button } from '../../components/atoms/Button.js';
import { TextField } from '../../components/atoms/TextField.js';
import { ConfirmDialog } from '../../components/molecules/ConfirmDialog.js';
import type { Environment, RuleWire } from '../../api/types.js';
import { confirmationFor } from './confirmation-for.js';
import {
  RULE_OPERATORS,
  draftFromWire,
  draftToWireRule,
  isValidRuleDraft,
  type RuleDraft,
  type RuleOperator,
} from './rule-draft.js';

export interface RuleEditorProps {
  readonly flagKey: string;
  readonly environment: Environment;
  readonly rules: readonly RuleWire[];
}

function rulesPath(ref: ConfigRef): string {
  return `/api/flags/${ref.flagKey}/config/${ref.environment}/rules`;
}

function moveIndex<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Container (D5): the ordered rule set for one environment, submitted as a
 * whole through `useVersionedMutation` (`PUT .../rules` replaces the entire
 * set — there is no per-rule endpoint). Rules are evaluated in array order —
 * the FIRST attribute match wins, and a rollout miss on that matched rule is
 * terminal (evaluation never falls through to a later rule) — so reordering
 * is a semantic edit, not cosmetic. "Move up"/"Move down" buttons make
 * reordering explicit and keyboard-operable, deliberately not drag-only.
 *
 * Save is gated by `confirmationFor` (D5b): production requires confirming a
 * `ConfirmDialog` before the mutation fires; development submits immediately.
 */
export function RuleEditor({ flagKey, environment, rules }: RuleEditorProps): ReactElement {
  const [drafts, setDrafts] = useState<readonly RuleDraft[]>(() => rules.map(draftFromWire));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const tier = confirmationFor(environment, 'rules');
  const mutation = useVersionedMutation<{ rules: RuleWire[] }>(
    { flagKey, environment },
    { method: 'PUT', path: rulesPath },
  );

  const save = (): void => {
    mutation.mutate({ rules: drafts.map(draftToWireRule) });
  };

  const updateDraft = (index: number, patch: Partial<RuleDraft>): void => {
    setDrafts(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const allValid = drafts.every(isValidRuleDraft);

  return (
    <section aria-label={`Rules — ${environment}`}>
      <h3>Rules</h3>
      {drafts.map((draft, index) => (
        // Index as key is deliberate: rows have no stable id, and index IS
        // the semantic order this editor manages (reordering renumbers rows).
        <div key={index} role="group" aria-label={`Rule ${index + 1}`}>
          <TextField
            id={`rule-attribute-${index}`}
            label={`Attribute — rule ${index + 1}`}
            value={draft.attribute}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              updateDraft(index, { attribute: event.target.value });
            }}
          />
          <label htmlFor={`rule-operator-${index}`}>{`Operator — rule ${index + 1}`}</label>
          <select
            id={`rule-operator-${index}`}
            value={draft.operator}
            onChange={(event) => {
              updateDraft(index, { operator: event.target.value as RuleOperator });
            }}
          >
            {RULE_OPERATORS.map((operator) => (
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </select>
          <TextField
            id={`rule-values-${index}`}
            label={`Values — rule ${index + 1}`}
            value={draft.valuesInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              updateDraft(index, { valuesInput: event.target.value });
            }}
          />
          <label htmlFor={`rule-serve-${index}`}>{`Serve — rule ${index + 1}`}</label>
          <input
            id={`rule-serve-${index}`}
            type="checkbox"
            checked={draft.serve}
            onChange={(event) => {
              updateDraft(index, { serve: event.target.checked });
            }}
          />
          <TextField
            id={`rule-rollout-${index}`}
            label={`Rollout % — rule ${index + 1}`}
            type="number"
            min={0}
            max={100}
            value={draft.rollout}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              updateDraft(index, { rollout: Number(event.target.value) });
            }}
          />
          <Button
            disabled={index === 0}
            onClick={() => {
              setDrafts(moveIndex(drafts, index, index - 1));
            }}
          >
            {`Move rule ${index + 1} up`}
          </Button>
          <Button
            disabled={index === drafts.length - 1}
            onClick={() => {
              setDrafts(moveIndex(drafts, index, index + 1));
            }}
          >
            {`Move rule ${index + 1} down`}
          </Button>
          <Button
            onClick={() => {
              setDrafts(drafts.filter((_, i) => i !== index));
            }}
          >
            {`Remove rule ${index + 1}`}
          </Button>
        </div>
      ))}
      <Button
        onClick={() => {
          setDrafts([
            ...drafts,
            { attribute: '', operator: 'in', valuesInput: '', serve: true, rollout: 100 },
          ]);
        }}
      >
        Add rule
      </Button>
      <Button
        disabled={!allValid}
        onClick={() => {
          if (tier === 'none') {
            save();
          } else {
            setConfirmOpen(true);
          }
        }}
      >
        Save rules
      </Button>
      {mutation.isError ? <p role="alert">Failed to save rules.</p> : null}
      <ConfirmDialog
        open={confirmOpen}
        flagKey={flagKey}
        environment={environment}
        targetStateLabel={`${drafts.length} rule(s)`}
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
