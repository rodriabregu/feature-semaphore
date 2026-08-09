import type {
  ExposureAggregate,
  ExposureBreakdown,
  ExposureBreakdownQuery,
  ExposureFlagTotal,
  ExposureRepository,
  ExposureWindowQuery,
} from '../../../application/ports/exposure-repository.js';
import type { Queryable } from './queryable.js';

/**
 * `total: string`, NEVER `number`. `"count"` is `BIGINT`, and `SUM(BIGINT)` is
 * `NUMERIC` in Postgres — a DIFFERENT type from `BIGINT` itself. node-postgres
 * leaves OID 20 (BIGINT) as a string, and never registers a parser for OID
 * 1700 (NUMERIC) at all, so the aggregate arrives as a string either way.
 * Typing the row as `string` forces `Number(...)` at the boundary below
 * rather than letting it be silently forgotten.
 */
interface BreakdownRowSql {
  value: boolean;
  reason: string;
  total: string;
}

interface FlagTotalRowSql {
  flag_key: string;
  total: string;
}

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

    async findBreakdown(query: ExposureBreakdownQuery): Promise<readonly ExposureBreakdown[]> {
      const result = await db.query<BreakdownRowSql>(
        `SELECT "value", reason, SUM("count") AS total
           FROM exposures
          WHERE flag_key = $1 AND environment = $2 AND bucket_hour >= $3
          GROUP BY "value", reason`,
        [query.flagKey, query.environment, query.since], // a Date binds directly
      );
      return result.rows.map((r) => ({ value: r.value, reason: r.reason, count: Number(r.total) }));
    },

    async listFlagTotals(query: ExposureWindowQuery): Promise<readonly ExposureFlagTotal[]> {
      const result = await db.query<FlagTotalRowSql>(
        `SELECT flag_key, SUM("count") AS total
           FROM exposures
          WHERE environment = $1 AND bucket_hour >= $2
          GROUP BY flag_key`,
        [query.environment, query.since],
      );
      return result.rows.map((r) => ({ flagKey: r.flag_key, total: Number(r.total) }));
    },
  };
}
