import type Database from 'better-sqlite3';
import type {
  ExposureAggregate,
  ExposureRepository,
} from '../../../application/ports/exposure-repository.js';

export function createSqliteExposureRepository(db: Database.Database): ExposureRepository {
  const upsert = db.prepare(
    `INSERT INTO exposures (flag_key, environment, bucket_hour, "value", reason, "count")
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (flag_key, environment, bucket_hour, "value", reason)
     DO UPDATE SET "count" = "count" + excluded."count"`,
  );

  return {
    recordBatch(rows: readonly ExposureAggregate[]): Promise<void> {
      for (const row of rows) {
        upsert.run(
          row.flagKey,
          row.environment,
          row.bucketHour.toISOString(),
          row.value ? 1 : 0,
          row.reason,
          row.count,
        );
      }
      return Promise.resolve();
    },
  };
}
