import { createHash } from 'node:crypto';
import type { Migration } from './index.js';

export type Dialect = 'postgres' | 'sqlite';

export interface AppliedMigration {
  readonly version: string;
  readonly checksum: string;
}

/**
 * Dialect-specific connection the runner drives. Each dialect implements its own
 * exclusive-lock strategy: Postgres uses a session-scoped `pg_advisory_lock`,
 * SQLite uses `BEGIN IMMEDIATE` to take the RESERVED write lock at statement one.
 */
export interface MigrationConnection {
  readonly dialect: Dialect;

  /** Runs `fn` under the dialect's exclusive migration lock, held for the whole run. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Whether `schema_migrations` exists yet. On a fresh database it does not — the
   * first migration creates it, so the runner must not blindly pre-create it (that
   * would collide with migration 001's own `CREATE TABLE schema_migrations`).
   */
  schemaMigrationsTableExists(): Promise<boolean>;

  /** Empty when `schemaMigrationsTableExists()` is false. */
  getAppliedMigrations(): Promise<readonly AppliedMigration[]>;

  /** Runs the migration's SQL and records it in `schema_migrations`, atomically. */
  applyMigration(migration: Migration, checksum: string, appliedAt: Date): Promise<void>;
}

export class MigrationChecksumMismatchError extends Error {
  constructor(readonly version: string) {
    super(`migration ${version} checksum mismatch: an applied migration's SQL was mutated`);
    this.name = 'MigrationChecksumMismatchError';
  }
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Applies every pending migration in array order, inside one exclusive lock.
 * Idempotent: re-running on a fully-migrated database issues one read and no DDL.
 * @throws MigrationChecksumMismatchError if an already-applied migration's SQL changed.
 */
export async function migrate(
  conn: MigrationConnection,
  migrations: readonly Migration[],
  now: () => Date,
): Promise<void> {
  await conn.withLock(async () => {
    const exists = await conn.schemaMigrationsTableExists();
    const applied = exists ? await conn.getAppliedMigrations() : [];
    const appliedByVersion = new Map(applied.map((m) => [m.version, m.checksum] as const));

    for (const migration of migrations) {
      const checksum = checksumOf(migration.sql);
      const existingChecksum = appliedByVersion.get(migration.version);

      if (existingChecksum !== undefined) {
        if (existingChecksum !== checksum) {
          throw new MigrationChecksumMismatchError(migration.version);
        }
        continue; // already applied, unchanged — no-op
      }

      await conn.applyMigration(migration, checksum, now());
    }
  });
}
