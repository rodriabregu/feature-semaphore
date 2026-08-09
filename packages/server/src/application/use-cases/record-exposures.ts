import type { Environment, FlagValue } from '@rodriab/feature-semaphore-core';
import type { Clock } from '../ports/clock.js';
import type { ExposureAggregate, ExposureRepository } from '../ports/exposure-repository.js';

export interface ExposureInput {
  readonly flagKey: string;
  readonly value: FlagValue;
  readonly reason: string;
  readonly count: number;
}

/**
 * `bucket_hour` is truncated to the UTC hour exactly ONCE, here, from
 * `clock.now()` — never per adapter, and never from client-supplied data. All
 * rows in a single batch therefore share one bucket, even if wall-clock time
 * ticks over an hour boundary mid-request.
 */
export function truncateToUtcHour(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()),
  );
}

export async function recordExposures(
  exposures: ExposureRepository,
  clock: Clock,
  environment: Environment,
  inputs: readonly ExposureInput[],
): Promise<void> {
  const bucketHour = truncateToUtcHour(clock.now());
  const rows: readonly ExposureAggregate[] = inputs.map((input) => ({
    flagKey: input.flagKey,
    environment,
    bucketHour,
    value: input.value,
    reason: input.reason,
    count: input.count,
  }));

  await exposures.recordBatch(rows);
}
