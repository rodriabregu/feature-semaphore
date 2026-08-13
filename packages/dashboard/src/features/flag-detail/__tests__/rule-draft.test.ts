import { describe, expect, it } from 'vitest';
import {
  draftFromWire,
  draftToWireRule,
  isValidRuleDraft,
  type RuleDraft,
  type RuleOperator,
} from '../rule-draft.js';
import type { RuleWire } from '../../../api/types.js';

function draft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return {
    attribute: 'plan',
    operator: 'in',
    valuesInput: 'pro, enterprise',
    serve: true,
    rollout: 100,
    ...overrides,
  };
}

describe('rule-draft — mirrors the server operator/values shape constraints (design D5)', () => {
  it('draftFromWire renders in/not_in values as a comma-separated list', () => {
    const rule: RuleWire = {
      attribute: 'plan',
      operator: 'in',
      values: ['pro', 'enterprise'],
      serve: true,
      rollout: 100,
    };
    expect(draftFromWire(rule).valuesInput).toBe('pro, enterprise');
  });

  it('draftFromWire renders a single-value operator as just that value', () => {
    const rule: RuleWire = {
      attribute: 'age',
      operator: 'gt',
      values: [21],
      serve: true,
      rollout: 50,
    };
    expect(draftFromWire(rule).valuesInput).toBe('21');
  });

  it.each([
    ['in', 'a, b, c', true],
    ['not_in', '', false],
    ['contains', 'checkout', true],
    ['contains', 'a, b', true], // exactly one string — commas are literal characters here, never split
    ['starts_with', '', false],
    ['gt', '21', true],
    ['gt', 'not-a-number', false],
    ['lt', '3.5', true],
  ] as [RuleOperator, string, boolean][])(
    'operator %s with input %j is valid: %s',
    (operator, valuesInput, expected) => {
      expect(isValidRuleDraft(draft({ operator, valuesInput }))).toBe(expected);
    },
  );

  it('rejects an empty attribute or an out-of-range rollout', () => {
    expect(isValidRuleDraft(draft({ attribute: '' }))).toBe(false);
    expect(isValidRuleDraft(draft({ rollout: 101 }))).toBe(false);
    expect(isValidRuleDraft(draft({ rollout: -1 }))).toBe(false);
  });

  it('draftToWireRule shapes values per operator — array for in/not_in, a single-element tuple otherwise', () => {
    expect(draftToWireRule(draft({ operator: 'in', valuesInput: 'a, b' }))).toEqual({
      attribute: 'plan',
      operator: 'in',
      values: ['a', 'b'],
      serve: true,
      rollout: 100,
    });
    expect(draftToWireRule(draft({ operator: 'gt', valuesInput: '21' }))).toEqual({
      attribute: 'plan',
      operator: 'gt',
      values: [21],
      serve: true,
      rollout: 100,
    });
  });
});
