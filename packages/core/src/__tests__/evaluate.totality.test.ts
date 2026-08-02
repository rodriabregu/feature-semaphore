import { describe, expect, it } from 'vitest';
import { evaluate } from '../evaluate.js';
import type { EvalContext, FlagDefinition } from '../types.js';

/**
 * Test-only helper: builds an intentionally malformed FlagDefinition-shaped value.
 * `def` is untrusted external data at the trust boundary (assembled from a DB row
 * or arrived over the wire) — evaluate() must be total for any runtime shape.
 */
function malformedDef(partial: Record<string, unknown>): FlagDefinition {
  return partial as unknown as FlagDefinition;
}

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return { unitId: 'user-x', attributes: {}, defaultValue: false, ...overrides };
}

describe('evaluate — totality for malformed FlagDefinition shapes (C2)', () => {
  it('an entirely empty object does not throw; falsy `enabled` is treated as the kill switch', () => {
    // def.enabled is undefined -> `!def.enabled` is true -> FLAG_OFF, per the
    // documented per-field defense table (truthiness only, cannot throw).
    // def.offValue is also undefined here: returning `undefined` as the value is
    // a documented, out-of-scope data defect (Phase 2 Zod), not a crash.
    expect(() => evaluate(malformedDef({}), ctx())).not.toThrow();
    expect(evaluate(malformedDef({}), ctx())).toEqual({ value: undefined, reason: 'FLAG_OFF' });
  });

  it('{enabled:true} with no overrides/rules/rollout does not throw and reaches fallthrough', () => {
    expect(() => evaluate(malformedDef({ enabled: true }), ctx())).not.toThrow();
    expect(evaluate(malformedDef({ enabled: true }), ctx())).toEqual({
      value: undefined,
      reason: 'FALLTHROUGH_ROLLOUT',
    });
  });

  it('overrides: null is skipped without throwing, falling through to rules/fallthrough', () => {
    const definition = malformedDef({ enabled: true, overrides: null });
    expect(() => evaluate(definition, ctx())).not.toThrow();
    expect(evaluate(definition, ctx())).toEqual({
      value: undefined,
      reason: 'FALLTHROUGH_ROLLOUT',
    });
  });

  it('rules: undefined degrades to no rules, not a throw', () => {
    const definition = malformedDef({ enabled: true, rules: undefined });
    expect(() => evaluate(definition, ctx())).not.toThrow();
    expect(evaluate(definition, ctx()).reason).toBe('FALLTHROUGH_ROLLOUT');
  });

  it('rules: null degrades to no rules, not a throw', () => {
    const definition = malformedDef({ enabled: true, rules: null });
    expect(() => evaluate(definition, ctx())).not.toThrow();
    expect(evaluate(definition, ctx()).reason).toBe('FALLTHROUGH_ROLLOUT');
  });

  it('rules: [null] is a non-match for that entry, continuing to fallthrough', () => {
    const definition = malformedDef({ enabled: true, rules: [null] });
    expect(() => evaluate(definition, ctx())).not.toThrow();
    expect(evaluate(definition, ctx()).reason).toBe('FALLTHROUGH_ROLLOUT');
  });

  it('a rule with rule.values: undefined does not throw and reaches fallthrough — proving matches() actually protects evaluate()', () => {
    const definition = malformedDef({
      key: 'fall-scope',
      salt: 'salt-f',
      enabled: true,
      offValue: false,
      onValue: true,
      rollout: 0,
      rules: [
        { operator: 'contains', attribute: 'plan', values: undefined, serve: true, rollout: 100 },
      ],
    });
    const context = ctx({ unitId: 'user-f', attributes: { plan: 'apple' } });
    expect(() => evaluate(definition, context)).not.toThrow();
    expect(evaluate(definition, context)).toEqual({ value: false, reason: 'FALLTHROUGH_ROLLOUT' });
  });

  it('a well-formed def with ctx.attributes absent treats every rule as a non-match, not a throw', () => {
    const definition = malformedDef({
      key: 'fall-scope',
      salt: 'salt-f',
      enabled: true,
      offValue: false,
      onValue: true,
      rollout: 0,
      rules: [{ operator: 'in', attribute: 'plan', values: ['pro'], serve: true, rollout: 100 }],
    });
    const context = malformedDef({
      unitId: 'user-f',
      defaultValue: false,
    }) as unknown as EvalContext;
    expect(() => evaluate(definition, context)).not.toThrow();
    expect(evaluate(definition, context)).toEqual({ value: false, reason: 'FALLTHROUGH_ROLLOUT' });
  });

  it('a non-numeric rollout ("fifty") yields NaN threshold -> nobody admitted, not a throw', () => {
    const definition = malformedDef({
      key: 'fall-scope',
      salt: 'salt-f',
      enabled: true,
      offValue: false,
      onValue: true,
      rollout: 'fifty',
    });
    expect(() => evaluate(definition, ctx({ unitId: 'user-f' }))).not.toThrow();
    expect(evaluate(definition, ctx({ unitId: 'user-f' }))).toEqual({
      value: false,
      reason: 'FALLTHROUGH_ROLLOUT',
    });
  });
});

describe('evaluate — prototype-pollution safety for overrides (C9)', () => {
  const prototypeChainIds = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];

  for (const unitId of prototypeChainIds) {
    it(`unitId '${unitId}' reachable only via the prototype chain does not yield OVERRIDE`, () => {
      // JSON.parse uses CreateDataProperty internally, immune to the object-literal
      // `__proto__` setter special case — this genuinely has one own property, "user-1".
      const overrides = JSON.parse('{"user-1":true}') as Record<string, boolean>;
      const definition = malformedDef({
        key: 'fall-scope',
        salt: 'salt-f',
        enabled: true,
        offValue: false,
        onValue: true,
        rollout: 0,
        overrides,
      });
      const result = evaluate(definition, ctx({ unitId }));
      expect(result.reason).not.toBe('OVERRIDE');
    });
  }

  it('a genuine own-property __proto__ override IS honored (Object.hasOwn reports it correctly)', () => {
    const overrides = JSON.parse('{"__proto__":true}') as Record<string, boolean>;
    const definition = malformedDef({
      key: 'fall-scope',
      salt: 'salt-f',
      enabled: true,
      offValue: false,
      overrides,
    });
    const result = evaluate(definition, ctx({ unitId: '__proto__' }));
    expect(result).toEqual({ value: true, reason: 'OVERRIDE' });
  });
});
