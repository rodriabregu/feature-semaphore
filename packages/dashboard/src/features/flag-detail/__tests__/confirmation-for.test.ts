import { describe, expect, it } from 'vitest';
import { confirmationFor, type ConfirmationAction } from '../confirmation-for.js';
import type { Environment } from '../../../api/types.js';

const ACTIONS: readonly ConfirmationAction[] = ['toggle', 'rollout', 'rules', 'overrides'];
const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

const CASES = ENVIRONMENTS.flatMap((environment) =>
  ACTIONS.map((action) => {
    const expected =
      environment === 'development' ? 'none' : action === 'toggle' ? 'type-key' : 'modal';
    return [environment, action, expected] as const;
  }),
);

describe('confirmationFor — tiered production confirmation (row 56)', () => {
  it.each(CASES)('%s + %s resolves to %s', (environment, action, expected) => {
    expect(confirmationFor(environment, action)).toBe(expected);
  });

  it('covers all 8 environment × action combinations, not a generic fallback', () => {
    expect(CASES).toHaveLength(8);
    expect(CASES.filter(([, , tier]) => tier === 'type-key')).toHaveLength(1);
    expect(CASES.filter(([, , tier]) => tier === 'modal')).toHaveLength(3);
    expect(CASES.filter(([, , tier]) => tier === 'none')).toHaveLength(4);
  });
});
