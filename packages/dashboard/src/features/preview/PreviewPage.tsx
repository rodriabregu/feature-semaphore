import { useState, type ReactElement, type SubmitEvent } from 'react';
import { usePreviewMutation } from '../../api/mutations/use-preview-mutation.js';
import { Button } from '../../components/atoms/Button.js';
import { TextField } from '../../components/atoms/TextField.js';
import type { AttributeValue } from '@rodriab/feature-semaphore-core';
import type { Environment, PreviewCandidateBody } from '../../api/types.js';
import { reasonLabel } from './reason-label.js';

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

/**
 * Parses the operator-supplied JSON textareas. Empty input is treated as
 * "not supplied" — `{}` for attributes (the server's own default, `schemas/
 * evaluate.ts`'s `attributesSchema.default({})`), `undefined` for the
 * candidate overlay, since an empty candidate is not the same as an
 * explicit empty-object overlay.
 */
function parseJsonField<T>(raw: string, emptyValue: T): T {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return emptyValue;
  }
  return JSON.parse(trimmed) as T;
}

/**
 * Container + form (D6, ladder row 60): `POST /evaluate/preview` is a pure
 * read (declared non-mutating at the BFF, §10.1) that answers the single
 * most valuable question a read-only demo can ask — "what would this flag
 * decide for this unit, and why". Both the evaluated `value` and a
 * human-readable `reason` label are shown (spec "Preview screen shows value
 * and reason"); `reasonLabel` — not this component — owns turning
 * `RULE_MATCH:${n}`/`RULE_ROLLOUT:${n}` into prose. The optional candidate
 * overlay previews unsaved rule/rollout edits without duplicating the full
 * rule editor's UI.
 */
export function PreviewPage(): ReactElement {
  const [flagKey, setFlagKey] = useState('');
  const [environment, setEnvironment] = useState<Environment>('development');
  const [unitId, setUnitId] = useState('');
  const [defaultValue, setDefaultValue] = useState(false);
  const [attributesJson, setAttributesJson] = useState('');
  const [candidateJson, setCandidateJson] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const mutation = usePreviewMutation();

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);

    let attributes: Readonly<Record<string, AttributeValue>>;
    try {
      attributes = parseJsonField(attributesJson, {});
    } catch {
      setFormError('Attributes must be valid JSON.');
      return;
    }

    let candidate: PreviewCandidateBody | undefined;
    try {
      candidate = parseJsonField<PreviewCandidateBody | undefined>(candidateJson, undefined);
    } catch {
      setFormError('Candidate overlay must be valid JSON.');
      return;
    }

    mutation.mutate({
      flag_key: flagKey,
      environment,
      context: { unit_id: unitId, attributes, default_value: defaultValue },
      candidate,
    });
  };

  return (
    <>
      <h1>Preview</h1>
      <form onSubmit={handleSubmit}>
        <TextField
          id="preview-flag-key"
          label="Flag key"
          value={flagKey}
          onChange={(event) => {
            setFlagKey(event.target.value);
          }}
          required
        />
        <label htmlFor="preview-environment">Environment</label>
        <select
          id="preview-environment"
          value={environment}
          onChange={(event) => {
            setEnvironment(event.target.value as Environment);
          }}
        >
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
        <TextField
          id="preview-unit-id"
          label="Unit ID"
          value={unitId}
          onChange={(event) => {
            setUnitId(event.target.value);
          }}
          required
        />
        <label htmlFor="preview-default-value">Default value</label>
        <input
          id="preview-default-value"
          type="checkbox"
          checked={defaultValue}
          onChange={(event) => {
            setDefaultValue(event.target.checked);
          }}
        />
        <label htmlFor="preview-attributes">Attributes (JSON, optional)</label>
        <textarea
          id="preview-attributes"
          value={attributesJson}
          onChange={(event) => {
            setAttributesJson(event.target.value);
          }}
        />
        <label htmlFor="preview-candidate">Candidate overlay (JSON, optional)</label>
        <textarea
          id="preview-candidate"
          value={candidateJson}
          onChange={(event) => {
            setCandidateJson(event.target.value);
          }}
        />
        <Button type="submit" disabled={mutation.isPending}>
          Preview
        </Button>
      </form>
      {formError ? <p role="alert">{formError}</p> : null}
      {mutation.isError ? <p role="alert">Failed to evaluate preview.</p> : null}
      {mutation.isSuccess ? (
        <section aria-label="Preview result">
          <p>Value: {String(mutation.data.value)}</p>
          <p>Reason: {reasonLabel(mutation.data.reason)}</p>
          <p>Candidate applied: {mutation.data.candidate_applied ? 'yes' : 'no'}</p>
        </section>
      ) : null}
    </>
  );
}
