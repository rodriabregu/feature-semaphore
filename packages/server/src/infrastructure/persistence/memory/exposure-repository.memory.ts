import type {
  ExposureAggregate,
  ExposureBreakdown,
  ExposureBreakdownQuery,
  ExposureFlagTotal,
  ExposureRepository,
  ExposureWindowQuery,
} from '../../../application/ports/exposure-repository.js';
import type { StoreAccessor } from './store.js';

/**
 * Upsert-increment over a `Map`-equivalent scan, keyed on the same five-tuple
 * the SQL adapters use. Matches the same additive semantics: a second call
 * with an identical key sums `count` into the existing row rather than
 * appending a new one.
 */
export function createMemoryExposureRepository(store: StoreAccessor): ExposureRepository {
  return {
    recordBatch(rows: readonly ExposureAggregate[]): Promise<void> {
      const s = store.get();
      for (const row of rows) {
        const bucketHourIso = row.bucketHour.toISOString();
        const existing = s.exposures.find(
          (e) =>
            e.flagKey === row.flagKey &&
            e.environment === row.environment &&
            e.bucketHourIso === bucketHourIso &&
            e.value === row.value &&
            e.reason === row.reason,
        );
        if (existing) {
          existing.count += row.count;
        } else {
          s.exposures.push({
            flagKey: row.flagKey,
            environment: row.environment,
            bucketHourIso,
            value: row.value,
            reason: row.reason,
            count: row.count,
          });
        }
      }
      return Promise.resolve();
    },

    findBreakdown(query: ExposureBreakdownQuery): Promise<readonly ExposureBreakdown[]> {
      const s = store.get();
      const sinceIso = query.since.toISOString();
      const acc = new Map<string, ExposureBreakdown>();
      for (const e of s.exposures) {
        if (e.flagKey !== query.flagKey || e.environment !== query.environment) continue;
        if (e.bucketHourIso < sinceIso) continue;
        const key = `${e.value ? '1' : '0'}\0${e.reason}`; // NUL cannot appear in either component
        const hit = acc.get(key);
        if (hit) acc.set(key, { ...hit, count: hit.count + e.count });
        else acc.set(key, { value: e.value, reason: e.reason, count: e.count });
      }
      return Promise.resolve(Array.from(acc.values()));
    },

    listFlagTotals(query: ExposureWindowQuery): Promise<readonly ExposureFlagTotal[]> {
      const s = store.get();
      const sinceIso = query.since.toISOString();
      const acc = new Map<string, number>();
      for (const e of s.exposures) {
        if (e.environment !== query.environment) continue;
        if (e.bucketHourIso < sinceIso) continue;
        acc.set(e.flagKey, (acc.get(e.flagKey) ?? 0) + e.count);
      }
      return Promise.resolve(
        Array.from(acc.entries()).map(([flagKey, total]) => ({ flagKey, total })),
      );
    },
  };
}
