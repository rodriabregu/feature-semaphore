import type { Client } from 'pg';
import type { Migration } from '../migrations/index.js';
import type { AppliedMigration, MigrationConnection } from '../migrations/runner.js';

/**
 * The constant advisory-lock key for the migration/seed startup sequence.
 * A BigInt literal, not a `Number`: `pg_advisory_lock` takes a 64-bit key, and
 * `0x5345_4d41_5048_4f52` ("SEMAPHOR" in ASCII hex) exceeds
 * `Number.MAX_SAFE_INTEGER` — a plain number literal would silently lose precision.
 */
const MIGRATION_LOCK_KEY = 0x5345_4d41_5048_4f52n;

/**
 * A dedicated session client held for the whole migration run. Session-scoped
 * `pg_advisory_lock`, not `pg_advisory_xact_lock`, because each migration commits
 * in its own transaction and a transaction-scoped lock would drop between them.
 */
export function createPostgresMigrationConnection(client: Client): MigrationConnection {
  return {
    dialect: 'postgres',

    async withLock<T>(fn: () => Promise<T>): Promise<T> {
      // `SET` does not accept a bound parameter for its value — Postgres rejects
      // `SET lock_timeout = $1` with a syntax error. The value is a fixed constant,
      // never user input, so a literal is safe here.
      await client.query("SET lock_timeout = '30s'");
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      }
    },

    async schemaMigrationsTableExists(): Promise<boolean> {
      const result = await client.query<{ exists: boolean }>(
        `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
      );
      return result.rows.at(0)?.exists ?? false;
    },

    async getAppliedMigrations(): Promise<readonly AppliedMigration[]> {
      const result = await client.query<AppliedMigration>(
        `SELECT version, checksum FROM schema_migrations`,
      );
      return result.rows;
    },

    async applyMigration(migration: Migration, checksum: string, appliedAt: Date): Promise<void> {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, checksum, applied_at) VALUES ($1, $2, $3)`,
          [migration.version, checksum, appliedAt.toISOString()],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  };
}
