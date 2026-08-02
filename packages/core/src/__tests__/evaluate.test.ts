import { describe, expect, it } from 'vitest';
import { evaluate } from '../evaluate.js';
import type { EvalContext, FlagDefinition, TargetingRule } from '../types.js';

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return { unitId: 'user-x', attributes: {}, defaultValue: false, ...overrides };
}

function def(overrides: Partial<FlagDefinition> = {}): FlagDefinition {
  return {
    key: 'flag-x',
    environment: 'production',
    archived: false,
    enabled: true,
    onValue: true,
    offValue: false,
    rollout: 0,
    salt: 'salt-x',
    rules: [],
    overrides: {},
    ...overrides,
  };
}

function rule(overrides: Partial<TargetingRule> & Pick<TargetingRule, 'operator'>): TargetingRule {
  return {
    attribute: 'plan',
    serve: true,
    rollout: 100,
    values: ['pro'],
    ...overrides,
  } as TargetingRule;
}

describe('evaluate — 9-row precedence table', () => {
  it('row 1: flag not found -> ctx.defaultValue, FLAG_NOT_FOUND', () => {
    expect(evaluate(null, ctx({ defaultValue: true }))).toEqual({
      value: true,
      reason: 'FLAG_NOT_FOUND',
    });
  });

  it('row 2: archived -> ctx.defaultValue, FLAG_ARCHIVED', () => {
    expect(evaluate(def({ archived: true }), ctx({ defaultValue: true }))).toEqual({
      value: true,
      reason: 'FLAG_ARCHIVED',
    });
  });

  it('row 3: kill switch (enabled=false) wins over a rule that would otherwise match', () => {
    const result = evaluate(
      def({ enabled: false, offValue: false, rules: [rule({ operator: 'in' })] }),
      ctx({ attributes: { plan: 'pro' } }),
    );
    expect(result).toEqual({ value: false, reason: 'FLAG_OFF' });
  });

  it('row 4: own-property override hit, evaluated before rules -> override value, OVERRIDE', () => {
    const result = evaluate(
      def({ overrides: { 'user-x': true }, offValue: false }),
      ctx({ unitId: 'user-x' }),
    );
    expect(result).toEqual({ value: true, reason: 'OVERRIDE' });
  });

  it('row 5: rule match, rollout >= 100 -> rule.serve, RULE_MATCH:i', () => {
    const result = evaluate(
      def({ rules: [rule({ operator: 'in', rollout: 100 })], offValue: false }),
      ctx({ attributes: { plan: 'pro' } }),
    );
    expect(result).toEqual({ value: true, reason: 'RULE_MATCH:0' });
  });

  it('row 6: rule match, unit inside the rule rollout bucket -> rule.serve, RULE_ROLLOUT:i', () => {
    // Oracle bucket for ('rule-scope','salt-r','user-r') = 1619 (precomputed via
    // murmurhash3js-revisited@3.0.0). rollout 20 -> threshold 2000 -> 1619 < 2000: inside.
    const result = evaluate(
      def({
        key: 'rule-scope',
        salt: 'salt-r',
        rules: [rule({ operator: 'in', rollout: 20 })],
        offValue: false,
      }),
      ctx({ unitId: 'user-r', attributes: { plan: 'pro' } }),
    );
    expect(result).toEqual({ value: true, reason: 'RULE_ROLLOUT:0' });
  });

  it('row 7: rule match, unit outside the rule rollout bucket -> def.offValue, RULE_ROLLOUT:i (terminal)', () => {
    // Same bucket (1619). rollout 10 -> threshold 1000 -> 1619 >= 1000: outside.
    // def-level rollout is 100 (would admit everyone) to prove this does NOT fall through.
    const result = evaluate(
      def({
        key: 'rule-scope',
        salt: 'salt-r',
        rules: [rule({ operator: 'in', rollout: 10 })],
        offValue: false,
        onValue: true,
        rollout: 100,
      }),
      ctx({ unitId: 'user-r', attributes: { plan: 'pro' } }),
    );
    expect(result).toEqual({ value: false, reason: 'RULE_ROLLOUT:0' });
  });

  it('row 8: no rule matched, unit inside the flag rollout bucket -> configured onValue (not a hardcoded literal), FALLTHROUGH_ROLLOUT', () => {
    // Oracle bucket for ('fall-scope','salt-f','user-f') = 7907. rollout 80 -> threshold 8000: inside.
    // onValue is deliberately `false` here to prove the branch serves the CONFIGURED
    // value, not a hardcoded `true`.
    const result = evaluate(
      def({ key: 'fall-scope', salt: 'salt-f', rollout: 80, onValue: false }),
      ctx({ unitId: 'user-f' }),
    );
    expect(result).toEqual({ value: false, reason: 'FALLTHROUGH_ROLLOUT' });
  });

  it('row 9: no rule matched, unit outside the flag rollout bucket -> def.offValue, FALLTHROUGH_ROLLOUT', () => {
    // Same bucket (7907). rollout 70 -> threshold 7000: outside.
    const result = evaluate(
      def({ key: 'fall-scope', salt: 'salt-f', rollout: 70, offValue: false }),
      ctx({ unitId: 'user-f' }),
    );
    expect(result).toEqual({ value: false, reason: 'FALLTHROUGH_ROLLOUT' });
  });
});

describe('evaluate — rule ordering behavior', () => {
  it('first attribute-matching rule wins; a later rule is never reached', () => {
    const nonMatching = rule({ attribute: 'plan', operator: 'in', values: ['enterprise'] });
    const matching = rule({ attribute: 'plan', operator: 'in', values: ['pro'], serve: true });
    const result = evaluate(
      def({ rules: [nonMatching, matching], offValue: false }),
      ctx({ attributes: { plan: 'pro' } }),
    );
    // reason index equals array position: the matching rule is at index 1.
    expect(result).toEqual({ value: true, reason: 'RULE_MATCH:1' });
  });

  it('a rule rollout miss is terminal and does not fall through to a later matching rule', () => {
    // bucket('rule-scope','salt-r','user-r') = 1619; rollout 10 -> threshold 1000: outside.
    const missingRule = rule({ operator: 'in', rollout: 10 });
    const laterMatchingRule = rule({ operator: 'in', rollout: 100 });
    const result = evaluate(
      def({
        key: 'rule-scope',
        salt: 'salt-r',
        rules: [missingRule, laterMatchingRule],
        offValue: false,
      }),
      ctx({ unitId: 'user-r', attributes: { plan: 'pro' } }),
    );
    expect(result).toEqual({ value: false, reason: 'RULE_ROLLOUT:0' });
  });
});

describe('evaluate — rollout boundary', () => {
  it('rollout <= 0 admits nobody without a special case (threshold 0, bucket < 0 is never true)', () => {
    const result = evaluate(
      def({ key: 'fall-scope', salt: 'salt-f', rollout: 0, offValue: false, onValue: true }),
      ctx({ unitId: 'user-f' }),
    );
    expect(result).toEqual({ value: false, reason: 'FALLTHROUGH_ROLLOUT' });
  });
});
