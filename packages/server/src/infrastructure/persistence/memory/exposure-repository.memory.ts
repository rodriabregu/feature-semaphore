import type {
  ExposureAggregate,
  ExposureRepository,
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
  };
}
