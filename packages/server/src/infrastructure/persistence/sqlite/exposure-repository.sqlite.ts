import type Database from 'better-sqlite3';
import type {
  ExposureAggregate,
  ExposureBreakdown,
  ExposureBreakdownQuery,
  ExposureFlagTotal,
  ExposureRepository,
  ExposureWindowQuery,
} from '../../../application/ports/exposure-repository.js';

interface BreakdownRowSql {
  value: number;
  reason: string;
  total: number;
}

interface FlagTotalRowSql {
  flag_key: string;
  total: number;
}

export function createSqliteExposureRepository(db: Database.Database): ExposureRepository {
  const upsert = db.prepare(
    `INSERT INTO exposures (flag_key, environment, bucket_hour, "value", reason, "count")
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (flag_key, environment, bucket_hour, "value", reason)
     DO UPDATE SET "count" = "count" + excluded."count"`,
  );

  const breakdownStmt = db.prepare<[string, string, string], BreakdownRowSql>(
    `SELECT "value", reason, SUM("count") AS total
       FROM exposures
      WHERE flag_key = ? AND environment = ? AND bucket_hour >= ?
      GROUP BY "value", reason`,
  );

  const flagTotalsStmt = db.prepare<[string, string], FlagTotalRowSql>(
    `SELECT flag_key, SUM("count") AS total
       FROM exposures
      WHERE environment = ? AND bucket_hour >= ?
      GROUP BY flag_key`,
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

    findBreakdown(query: ExposureBreakdownQuery): Promise<readonly ExposureBreakdown[]> {
      const rows = breakdownStmt.all(
        query.flagKey,
        query.environment,
        query.since.toISOString(), // bind the ISO STRING, never a raw Date
      );
      return Promise.resolve(
        rows.map((r) => ({ value: r.value === 1, reason: r.reason, count: r.total })),
      );
    },

    listFlagTotals(query: ExposureWindowQuery): Promise<readonly ExposureFlagTotal[]> {
      const rows = flagTotalsStmt.all(query.environment, query.since.toISOString());
      return Promise.resolve(rows.map((r) => ({ flagKey: r.flag_key, total: r.total })));
    },
  };
}
