import { describe, expect, it } from 'vitest';
import { diffEntry } from '../audit-diff.js';

describe('diffEntry — before/after field diff (row 61)', () => {
  it('marks a field present in both snapshots with a different value as changed', () => {
    const fields = diffEntry(
      { rollout_percentage: 20, enabled: true },
      { rollout_percentage: 35, enabled: true },
    );

    const rollout = fields.find((f) => f.key === 'rollout_percentage');
    const enabled = fields.find((f) => f.key === 'enabled');

    expect(rollout).toEqual({ key: 'rollout_percentage', before: 20, after: 35, changed: true });
    expect(enabled).toEqual({ key: 'enabled', before: true, after: true, changed: false });
  });

  it('includes a key present only in after (create) as changed, before undefined', () => {
    const fields = diffEntry(null, { enabled: true });

    expect(fields).toEqual([{ key: 'enabled', before: undefined, after: true, changed: true }]);
  });

  it('includes a key present only in before (unusual, but handled) as changed, after undefined', () => {
    const fields = diffEntry({ enabled: true }, {});

    expect(fields).toEqual([{ key: 'enabled', before: true, after: undefined, changed: true }]);
  });

  it('returns no fields when both snapshots are null (never crashes on a null before)', () => {
    expect(diffEntry(null, null)).toEqual([]);
  });

  it('deep-compares object/array values rather than reference-comparing them', () => {
    const fields = diffEntry(
      { rules: [{ attribute: 'plan' }] },
      { rules: [{ attribute: 'plan' }] },
    );

    expect(fields).toEqual([
      {
        key: 'rules',
        before: [{ attribute: 'plan' }],
        after: [{ attribute: 'plan' }],
        changed: false,
      },
    ]);
  });
});
