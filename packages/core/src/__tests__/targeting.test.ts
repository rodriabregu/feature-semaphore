import { describe, expect, it } from 'vitest';
import { matches } from '../targeting.js';
import type { AttributeValue, EvalContext, TargetingRule } from '../types.js';

/**
 * Test-only helper: builds an intentionally loosely-typed rule/attribute value so
 * malformed-input scenarios (the entire point of this file) can be constructed at
 * all. Production callers never need this — `matches()`'s own runtime guards are
 * what is under test.
 */
function unsafeRule(partial: Record<string, unknown>): TargetingRule {
  return partial as unknown as TargetingRule;
}

function attrs(record: Record<string, AttributeValue | undefined>): EvalContext['attributes'] {
  return record;
}

describe('matches — operator semantics', () => {
  const operatorCases: readonly [string, readonly unknown[], AttributeValue, boolean][] = [
    ['in', ['a', 'b'], 'a', true],
    ['not_in', ['a', 'b'], 'c', true],
    ['contains', ['foo'], 'foobar', true],
    ['starts_with', ['foo'], 'foobar', true],
    ['gt', [10], 11, true],
    ['lt', [10], 9, true],
  ];

  for (const [operator, values, attributeValue, expected] of operatorCases) {
    it(`${operator} evaluates the documented case correctly`, () => {
      const rule = unsafeRule({ attribute: 'attr', serve: true, rollout: 100, operator, values });
      expect(matches(rule, attrs({ attr: attributeValue }))).toBe(expected);
    });
  }
});

describe('matches — cross-cutting non-match and safety rules', () => {
  it('treats an absent attribute as a non-match', () => {
    const rule = unsafeRule({
      attribute: 'plan',
      serve: true,
      rollout: 100,
      operator: 'in',
      values: ['pro'],
    });
    expect(matches(rule, attrs({}))).toBe(false);
  });

  it('does not coerce types for gt: a string attribute is a non-match', () => {
    const rule = unsafeRule({
      attribute: 'age',
      serve: true,
      rollout: 100,
      operator: 'gt',
      values: [10],
    });
    expect(matches(rule, attrs({ age: '20' }))).toBe(false);
  });

  it('rejects a NaN attribute for gt without coercion', () => {
    const rule = unsafeRule({
      attribute: 'age',
      serve: true,
      rollout: 100,
      operator: 'gt',
      values: [10],
    });
    expect(matches(rule, attrs({ age: Number.NaN }))).toBe(false);
  });

  it('compares strings case-sensitively for in', () => {
    const rule = unsafeRule({
      attribute: 'plan',
      serve: true,
      rollout: 100,
      operator: 'in',
      values: ['Pro'],
    });
    expect(matches(rule, attrs({ plan: 'pro' }))).toBe(false);
  });

  it('treats malformed rule.values as a non-match for in, without throwing', () => {
    const rule = unsafeRule({
      attribute: 'plan',
      serve: true,
      rollout: 100,
      operator: 'in',
      values: 'pro',
    });
    expect(() => matches(rule, attrs({ plan: 'pro' }))).not.toThrow();
    expect(matches(rule, attrs({ plan: 'pro' }))).toBe(false);
  });

  it('not_in never matches an absent attribute', () => {
    const rule = unsafeRule({
      attribute: 'plan',
      serve: true,
      rollout: 100,
      operator: 'not_in',
      values: ['pro'],
    });
    expect(matches(rule, attrs({}))).toBe(false);
  });

  it('an unrecognized operator is a non-match, without throwing', () => {
    const rule = unsafeRule({
      attribute: 'plan',
      serve: true,
      rollout: 100,
      operator: 'between',
      values: ['a', 'z'],
    });
    expect(() => matches(rule, attrs({ plan: 'm' }))).not.toThrow();
    expect(matches(rule, attrs({ plan: 'm' }))).toBe(false);
  });

  it('empty values: not_in matches everything (empty exclusion list excludes nobody)', () => {
    const rule = unsafeRule({
      attribute: 'plan',
      serve: true,
      rollout: 100,
      operator: 'not_in',
      values: [],
    });
    expect(matches(rule, attrs({ plan: 'anything' }))).toBe(true);
  });

  it('empty values: in matches nothing', () => {
    const rule = unsafeRule({
      attribute: 'plan',
      serve: true,
      rollout: 100,
      operator: 'in',
      values: [],
    });
    expect(matches(rule, attrs({ plan: 'anything' }))).toBe(false);
  });
});

describe('matches — 20-row malformed rule.values matrix (C2, rev 3)', () => {
  // rev 2 shipped exactly one malformed-values test, on `in` — the one operator
  // whose own Array.isArray guard already covered the hole — and the defect
  // survived two review passes. This matrix exists so operator coverage can
  // never again be mistaken for value-shape coverage: 4 operators whose element
  // guards dereference `values[0]` × 5 malformed shapes for `rule.values`.
  const vulnerableOperators = ['contains', 'starts_with', 'gt', 'lt'] as const;
  const malformedShapes: readonly [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['string', 'pro'],
    ['number', 42],
    ['emptyArray', []],
  ];

  for (const operator of vulnerableOperators) {
    for (const [shapeName, values] of malformedShapes) {
      it(`${operator} × values=${shapeName} does not throw and is a non-match`, () => {
        // The 'pro' rows use attribute 'apple': rev 2's guard read `values[0] === 'p'`
        // (treating the string 'pro' as an array) and returned true for contains —
        // exactly the bug this matrix exists to catch, on the one attribute value
        // ('apple') where a correct implementation and the rev 2 bug diverge.
        const attributeValue: AttributeValue = operator === 'gt' || operator === 'lt' ? 5 : 'apple';
        const rule = unsafeRule({
          attribute: 'attr',
          serve: true,
          rollout: 100,
          operator,
          values,
        });

        expect(() => matches(rule, attrs({ attr: attributeValue }))).not.toThrow();
        expect(matches(rule, attrs({ attr: attributeValue }))).toBe(false);
      });
    }
  }
});
