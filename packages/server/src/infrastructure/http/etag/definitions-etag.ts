import { createHash } from 'node:crypto';
import type { Environment, FlagDefinition, TargetingRule } from '@rodriab/feature-semaphore-core';

/**
 * UTF-16 code-unit order: locale-independent, engine-independent. NOT
 * `localeCompare`, which is locale-dependent and would make the ETag depend
 * on the process's ICU data.
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sorted by `key` (UNIQUE in both dialects, so the sort is total — no
 * tie-break is needed or possible). `rules` is left UNTOUCHED — its array
 * position IS the evaluation semantics (`RULE_MATCH:${i}`), and reordering it
 * would silently change what the flag does. `overrides` is NOT rebuilt here:
 * a plain JS object cannot durably hold a custom key order (integer-like
 * keys are always re-enumerated ascending, irrespective of insertion order),
 * so the canonical override order is produced once, directly into an array,
 * in `canonicalString` below — never round-tripped through another object.
 */
export function sortDefinitions(defs: readonly FlagDefinition[]): readonly FlagDefinition[] {
  return [...defs].sort((a, b) => byCodeUnit(a.key, b.key));
}

function encodeRule(rule: TargetingRule): unknown[] {
  return [rule.attribute, rule.operator, rule.values, rule.serve, rule.rollout];
}

/** `Object.entries(...)` sorted by `byCodeUnit`, emitted as `[[unitId, serve], …]`. */
function encodeOverrides(overrides: FlagDefinition['overrides']): unknown[] {
  return Object.entries(overrides)
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([unitId, serve]) => [unitId, serve]);
}

function encodeDefinition(def: FlagDefinition): unknown[] {
  return [
    def.key,
    def.environment,
    def.archived,
    def.enabled,
    def.onValue,
    def.offValue,
    def.rollout,
    def.salt,
    def.rules.map(encodeRule), // array order preserved — never sorted
    encodeOverrides(def.overrides),
  ];
}

/**
 * Tuple-encoded, whitespace-free. Arrays only — `JSON.stringify` serialises
 * arrays strictly by index (a spec guarantee), whereas object key order is
 * merely "usually insertion order" and is exactly what breaks across adapters.
 * @param sorted MUST already be `sortDefinitions`'s output.
 */
export function canonicalString(sorted: readonly FlagDefinition[], env: Environment): string {
  return JSON.stringify(['fs-defs/1', env, sorted.map(encodeDefinition)]);
}

/** `"<64 lowercase hex>"` — a strong entity-tag, quoted like Phase 2's version ETags. */
export function definitionsEtag(canonical: string): string {
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `"${hex}"`;
}
