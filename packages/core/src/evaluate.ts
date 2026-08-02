import { bucket, rolloutThreshold } from './bucketing.js';
import { matches } from './targeting.js';
import type { Evaluation, EvalContext, FlagDefinition, FlagValue, TargetingRule } from './types.js';

const NO_RULES: readonly TargetingRule[] = [];

/**
 * Trust boundary: `def` is UNTRUSTED. It is assembled from a DB row or arrives over
 * the wire, so evaluate() must be total for any runtime shape, including `{}` — see
 * the per-field defense table below. `ctx` is caller-supplied and typed; only
 * `ctx.attributes` is defended (via matches()'s own prelude), because it is the one
 * `ctx` field that flows into a nested read. This boundary must not be widened
 * without updating this comment.
 *
 * | Field                              | Absent/malformed behavior                              |
 * |-------------------------------------|--------------------------------------------------------|
 * | def null/undefined                  | FLAG_NOT_FOUND                                          |
 * | def.archived, def.enabled           | falsy -> not-archived / not-enabled (truthiness only)   |
 * | def.overrides                       | not an object -> override step skipped (isRecord)       |
 * | def.overrides[unitId] on prototype  | not an own property -> skipped (Object.hasOwn)          |
 * | def.rules                           | not an array -> NO_RULES, straight to fallthrough        |
 * | rules[i] is null                    | non-match, loop continues (matches()'s isRecord guard)  |
 * | rules[i].values malformed           | non-match, loop continues (matches()'s Array.isArray)   |
 * | ctx.attributes absent               | every rule is a non-match (matches()'s isRecord guard)  |
 * | def.rollout / rule.rollout non-numeric | rolloutThreshold -> NaN; `bucket < NaN` is false      |
 * | def.key / def.salt non-string       | template-literal coercion; deterministic, no throw       |
 * | def.onValue / def.offValue absent   | returns `undefined` as the value — a data defect, not a crash (out of scope: Phase 2 Zod) |
 */
export function evaluate(def: FlagDefinition | null | undefined, ctx: EvalContext): Evaluation {
  if (!def) return { value: ctx.defaultValue, reason: 'FLAG_NOT_FOUND' };
  if (def.archived) return { value: ctx.defaultValue, reason: 'FLAG_ARCHIVED' };
  if (!def.enabled) return { value: def.offValue, reason: 'FLAG_OFF' }; // kill switch wins

  // C2 + C9: presence-checked own property only — no prototype chain, no unguarded deref.
  const { overrides } = def;
  if (isRecord(overrides) && Object.hasOwn(overrides, ctx.unitId)) {
    // `overrides` is untrusted external data: a malformed def can still store an
    // explicit `undefined` for an own key even though the declared type says indexing
    // always yields a `FlagValue`. The cast makes that real runtime possibility visible
    // to the type checker so the following guard is meaningful, not unreachable.
    const override = overrides[ctx.unitId] as FlagValue | undefined;
    if (override !== undefined) return { value: override, reason: 'OVERRIDE' };
  }

  // C2: a non-array `rules` degrades to "no rules", it does not throw.
  // The explicit annotation matters: `Array.isArray` narrows a `readonly T[]` through
  // its `any[]` predicate type, which otherwise leaks `any` into every `rule` read below.
  const rules: readonly TargetingRule[] = Array.isArray(def.rules) ? def.rules : NO_RULES;
  for (const [i, rule] of rules.entries()) {
    if (!matches(rule, ctx.attributes)) continue; // first ATTRIBUTE match wins
    if (rule.rollout >= 100) return { value: rule.serve, reason: `RULE_MATCH:${i}` };
    const inBucket = bucket(def.key, def.salt, ctx.unitId) < rolloutThreshold(rule.rollout); // C3
    return { value: inBucket ? rule.serve : def.offValue, reason: `RULE_ROLLOUT:${i}` };
  }

  const inBucket = bucket(def.key, def.salt, ctx.unitId) < rolloutThreshold(def.rollout); // C3
  return { value: inBucket ? def.onValue : def.offValue, reason: 'FALLTHROUGH_ROLLOUT' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
