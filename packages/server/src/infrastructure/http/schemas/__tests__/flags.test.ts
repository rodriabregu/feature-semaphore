import { describe, expect, it } from 'vitest';
import { targetingRuleBody } from '../flags.js';

/**
 * `targetingRuleBody`'s three discriminated-union members were bare
 * `z.object(...)` (strip-by-default) before this change — an unknown key,
 * including `salt`, was silently discarded rather than rejected. `.strict()`
 * cannot be applied to the union itself (`ZodDiscriminatedUnion` exposes no
 * `.strict()`), so each member must carry its own.
 */
describe('targetingRuleBody — per-member .strict()', () => {
  it('rejects an unknown key on the in/not_in member', () => {
    const result = targetingRuleBody.safeParse({
      operator: 'in',
      attribute: 'plan',
      values: ['pro'],
      serve: true,
      rollout: 100,
      salt: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('rejects an unknown key on the contains/starts_with member', () => {
    const result = targetingRuleBody.safeParse({
      operator: 'starts_with',
      attribute: 'plan',
      values: ['pro'],
      serve: true,
      rollout: 100,
      salt: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('rejects an unknown key on the gt/lt member', () => {
    const result = targetingRuleBody.safeParse({
      operator: 'gt',
      attribute: 'age',
      values: [30],
      serve: true,
      rollout: 100,
      salt: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});
