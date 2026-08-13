export interface DiffField {
  readonly key: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly changed: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * `before`/`after` are full untyped snapshots (design D7,
 * `application/ports/audit-log.ts:11-12`) — never a typed `FlagConfig`, so
 * this diffs by structural JSON equality over each top-level key present in
 * either snapshot, rather than assuming a fixed shape. A key present only
 * in one side (e.g. `flag.created`'s `before: null`) is still surfaced as
 * changed, with the missing side reported as `undefined`.
 */
export function diffEntry(before: unknown, after: unknown): readonly DiffField[] {
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);

  return [...keys].sort().map((key) => {
    const beforeValue = beforeRecord[key];
    const afterValue = afterRecord[key];
    return {
      key,
      before: beforeValue,
      after: afterValue,
      changed: JSON.stringify(beforeValue) !== JSON.stringify(afterValue),
    };
  });
}
