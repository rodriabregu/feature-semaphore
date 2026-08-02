export type FlagValue = boolean; // MVP boolean-only; widening is a change HERE
export type Environment = 'development' | 'production';

/**
 * 0..100 with at most 2 decimals. NOTE: `rollout * 100` is NOT reliably an integer
 * in IEEE-754 (0.07 * 100 === 7.000000000000001). Always convert through
 * `rolloutThreshold()` in bucketing.ts — never inline the multiplication.
 */
export type RolloutPercentage = number;

export type AttributeValue = string | number | boolean;

interface TargetingRuleBase {
  readonly attribute: string;
  readonly serve: FlagValue;
  readonly rollout: RolloutPercentage;
}

/** Discriminated on `operator` so a value-shape bug is a compile error, not a silent non-match. */
export type TargetingRule =
  | (TargetingRuleBase & {
      readonly operator: 'in' | 'not_in';
      readonly values: readonly AttributeValue[];
    })
  | (TargetingRuleBase & {
      readonly operator: 'contains' | 'starts_with';
      readonly values: readonly [string];
    })
  | (TargetingRuleBase & { readonly operator: 'gt' | 'lt'; readonly values: readonly [number] });

export type Operator = TargetingRule['operator'];

/**
 * The ASSEMBLED per-environment shape evaluate() consumes (flag + config + rules + overrides).
 * @precondition `rules` is already sorted ascending by the persisted `position`.
 *   evaluate() does not sort; reason indices are array positions.
 */
export interface FlagDefinition {
  readonly key: string;
  readonly environment: Environment;
  readonly archived: boolean;
  readonly enabled: boolean;
  readonly onValue: FlagValue;
  readonly offValue: FlagValue;
  readonly rollout: RolloutPercentage;
  readonly salt: string;
  readonly rules: readonly TargetingRule[];
  readonly overrides: Readonly<Record<string, FlagValue>>;
}

// `FlagConfig` (the raw per-environment persistence row: id, flag_id, environment,
// enabled, off_value, on_value, rollout_percentage, salt, version, updated_at) is
// deliberately NOT declared here. It is Phase 2 `server` persistence layer's type: it
// carries surrogate keys and the optimistic-concurrency `version`, and declaring it in
// this zero-dependency domain package would make `core` the authority on a DB row and
// leak `If-Match`/412 concerns into the pure evaluation layer. `FlagDefinition` above is
// the assembled shape `server`/`sdk-node` build from `FlagConfig` before calling evaluate().

export interface EvalContext {
  readonly unitId: string;
  readonly attributes: Readonly<Record<string, AttributeValue | undefined>>;
  readonly defaultValue: FlagValue;
}

export type EvaluationReason =
  | 'FLAG_NOT_FOUND'
  | 'FLAG_ARCHIVED'
  | 'FLAG_OFF'
  | 'OVERRIDE'
  | 'FALLTHROUGH_ROLLOUT'
  | `RULE_MATCH:${number}`
  | `RULE_ROLLOUT:${number}`;

export interface Evaluation {
  readonly value: FlagValue;
  readonly reason: EvaluationReason;
}
