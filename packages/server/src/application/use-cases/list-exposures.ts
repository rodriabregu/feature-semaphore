import type { Environment } from '@rodriab/feature-semaphore-core';
import type {
  ExposureBreakdown,
  ExposureFlagTotal,
  ExposureRepository,
} from '../ports/exposure-repository.js';
import { truncateToUtcHour } from './record-exposures.js';

export interface ListExposuresQuery {
  readonly flagKey: string;
  readonly environment: Environment;
  readonly since: Date;
}

export interface ListExposuresResult {
  /** The EFFECTIVE (hour-truncated) window — never the raw caller input. */
  readonly since: Date;
  readonly total: number;
  readonly breakdown: readonly ExposureBreakdown[];
}

function compareBreakdown(a: ExposureBreakdown, b: ExposureBreakdown): number {
  if (a.count !== b.count) return b.count - a.count; // count DESC
  if (a.reason < b.reason) return -1; // then reason in code-unit order — never localeCompare
  if (a.reason > b.reason) return 1;
  return 0;
}

/**
 * `total` is DERIVED from `breakdown`, never a second query — one round
 * trip, one code path, `total` and `breakdown` consistent by construction.
 */
export async function listExposures(
  exposures: ExposureRepository,
  query: ListExposuresQuery,
): Promise<ListExposuresResult> {
  const since = truncateToUtcHour(query.since); // reused, never re-implemented
  const breakdown = await exposures.findBreakdown({
    flagKey: query.flagKey,
    environment: query.environment,
    since,
  });
  const total = breakdown.reduce((sum, row) => sum + row.count, 0);
  const sorted = [...breakdown].sort(compareBreakdown);

  return { since, total, breakdown: sorted };
}

export interface ListFlagTotalsQuery {
  readonly environment: Environment;
  readonly since: Date;
}

export interface ListFlagTotalsResult {
  readonly since: Date;
  readonly flags: readonly ExposureFlagTotal[];
}

function compareFlagTotal(a: ExposureFlagTotal, b: ExposureFlagTotal): number {
  if (a.flagKey < b.flagKey) return -1; // code-unit order — never localeCompare
  if (a.flagKey > b.flagKey) return 1;
  return 0;
}

export async function listFlagTotals(
  exposures: ExposureRepository,
  query: ListFlagTotalsQuery,
): Promise<ListFlagTotalsResult> {
  const since = truncateToUtcHour(query.since);
  const totals = await exposures.listFlagTotals({ environment: query.environment, since });
  const sorted = [...totals].sort(compareFlagTotal);

  return { since, flags: sorted };
}
