import { useState, type ReactElement, type SubmitEvent } from 'react';
import { useAuditQuery } from '../../api/queries/audit.js';
import { Button } from '../../components/atoms/Button.js';
import { TextField } from '../../components/atoms/TextField.js';
import type { AuditEntryWire } from '../../api/types.js';
import { diffEntry } from './audit-diff.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** Server-side cap (`auditQuery` schema, 1-500, default 50) — mirrored here
 * so a client-side "give me everything" request never becomes an
 * unbounded query the operator believes is honoured. */
function clampLimit(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return '—';
  }
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return value.toString();
    default:
      // object, function, symbol, or null — JSON.stringify(null) is 'null'.
      return JSON.stringify(value);
  }
}

interface AuditEntryDiffProps {
  readonly entry: AuditEntryWire;
}

/**
 * Renders each top-level field of `before`/`after` as a row, marking a
 * changed field with real `<del>`/`<ins>` semantic markup (spec "Audit
 * entry diff": "the changed field is visually distinguished as before vs
 * after") — never just two plain cells indistinguishable from an
 * unchanged field.
 */
function AuditEntryDiff({ entry }: AuditEntryDiffProps): ReactElement {
  const fields = diffEntry(entry.before, entry.after);

  if (fields.length === 0) {
    return <p>No field-level changes recorded.</p>;
  }

  return (
    <table>
      <caption>Change diff</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.key}>
            <th scope="row">{field.key}</th>
            <td>
              {field.changed ? (
                <del>{formatDiffValue(field.before)}</del>
              ) : (
                formatDiffValue(field.before)
              )}
            </td>
            <td>
              {field.changed ? (
                <ins>{formatDiffValue(field.after)}</ins>
              ) : (
                formatDiffValue(field.after)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface AuditEntryItemProps {
  readonly entry: AuditEntryWire;
}

/**
 * `actor` is an opaque `api_keys.id` (`audit-log.ts:7`) — there is exactly
 * one admin key system-wide, so every row carries the same id. Labelled
 * honestly as a system/API-key identity; never rendered in a way that
 * implies a human operator name (spec "Audit entry diff").
 */
function AuditEntryItem({ entry }: AuditEntryItemProps): ReactElement {
  return (
    <li>
      <p>Action: {entry.action}</p>
      <p>Environment: {entry.environment ?? 'flag-scoped'}</p>
      <p>When: {new Date(entry.createdAt).toLocaleString()}</p>
      <p>System (API key): {entry.actor}</p>
      <AuditEntryDiff entry={entry} />
    </li>
  );
}

/**
 * Container (D7): the audit screen. `GET /flags/:key/audit` requires a
 * flag key, so this is a search form rather than a fixed route param —
 * the operator loads one flag's history at a time.
 */
export function AuditPage(): ReactElement {
  const [flagKeyInput, setFlagKeyInput] = useState('');
  const [limitInput, setLimitInput] = useState(String(DEFAULT_LIMIT));
  const [queryFlagKey, setQueryFlagKey] = useState('');
  const [queryLimit, setQueryLimit] = useState(DEFAULT_LIMIT);

  const auditQuery = useAuditQuery(queryFlagKey, queryLimit);

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setQueryFlagKey(flagKeyInput);
    setQueryLimit(clampLimit(limitInput));
  };

  return (
    <>
      <h1>Audit</h1>
      <form onSubmit={handleSubmit}>
        <TextField
          id="audit-flag-key"
          label="Flag key"
          value={flagKeyInput}
          onChange={(event) => {
            setFlagKeyInput(event.target.value);
          }}
          required
        />
        <TextField
          id="audit-limit"
          label="Limit"
          type="number"
          value={limitInput}
          onChange={(event) => {
            setLimitInput(event.target.value);
          }}
        />
        <Button type="submit">Load audit log</Button>
      </form>
      {auditQuery.isPending && queryFlagKey.length > 0 ? <p>Loading audit log…</p> : null}
      {auditQuery.isError ? <p role="alert">Failed to load audit log.</p> : null}
      {auditQuery.data ? (
        auditQuery.data.entries.length === 0 ? (
          <p>No audit entries for this flag.</p>
        ) : (
          <ul aria-label="Audit entries">
            {auditQuery.data.entries.map((entry, index) => (
              // Entries have no stable id in the wire shape; index is
              // acceptable since this list is never reordered client-side.
              <AuditEntryItem key={index} entry={entry} />
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
