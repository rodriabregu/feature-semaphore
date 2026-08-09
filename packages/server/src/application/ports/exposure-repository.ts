import type { Environment, FlagValue } from '@rodriab/feature-semaphore-core';

/**
 * `reason` is deliberately `string`, not `EvaluationReason`. `EvaluationReason`
 * includes the template-literal members `RULE_MATCH:${number}` /
 * `RULE_ROLLOUT:${number}` — an unbounded set. A client's buffered
 * `RULE_MATCH:3` may name a rule index that no longer exists by flush time;
 * rejecting it would discard honest telemetry over a race this design already
 * accepts. Cardinality is bounded at the edge instead (length <= 64, batch
 * <= 500 — see `http/schemas/sdk.ts`), not by an enum.
 */
export interface ExposureAggregate {
  readonly flagKey: string;
  readonly environment: Environment;
  /** Truncated to the hour, UTC, derived from the injected `Clock` — never client time. */
  readonly bucketHour: Date;
  readonly value: FlagValue;
  readonly reason: string;
  readonly count: number;
}

export interface ExposureRepository {
  /**
   * Upsert-increment on the composite key
   * `(flagKey, environment, bucketHour, value, reason)`. Additive, never
   * replacing: a second call with the same key sums `count` rather than
   * overwriting it.
   */
  recordBatch(rows: readonly ExposureAggregate[]): Promise<void>;
}
