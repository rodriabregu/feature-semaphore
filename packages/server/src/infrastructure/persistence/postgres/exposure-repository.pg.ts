import type {
  ExposureAggregate,
  ExposureRepository,
} from '../../../application/ports/exposure-repository.js';
import type { Queryable } from './queryable.js';

export function createPostgresExposureRepository(db: Queryable): ExposureRepository {
  return {
    async recordBatch(rows: readonly ExposureAggregate[]): Promise<void> {
      for (const row of rows) {
        await db.query(
          `INSERT INTO exposures (flag_key, environment, bucket_hour, "value", reason, "count")
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (flag_key, environment, bucket_hour, "value", reason)
           DO UPDATE SET "count" = exposures."count" + EXCLUDED."count"`,
          [row.flagKey, row.environment, row.bucketHour, row.value, row.reason, row.count],
        );
      }
    },
  };
}
