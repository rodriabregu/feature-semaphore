import { describe, expect, it } from 'vitest';
import type { TargetingRule } from '../types.js';

describe('TargetingRule discriminated union', () => {
  it('rejects a gt rule whose values are strings, not a numeric tuple', () => {
    // @ts-expect-error 'gt' requires `values: readonly [number]`, not a string array.
    const invalid: TargetingRule = {
      attribute: 'age',
      serve: true,
      rollout: 100,
      operator: 'gt',
      values: ['x'],
    };
    expect(invalid.operator).toBe('gt');
  });

  it('accepts a well-formed gt rule with a numeric tuple', () => {
    const valid: TargetingRule = {
      attribute: 'age',
      serve: true,
      rollout: 100,
      operator: 'gt',
      values: [10],
    };
    expect(valid.values[0]).toBe(10);
  });
});
