import Database from 'better-sqlite3';
import type { Migration } from '../migrations/index.js';
import type { AppliedMigration, MigrationConnection } from '../migrations/runner.js';

/** Opens a SQLite database with the three mandatory pragmas set once, at open. */
export function openSqliteDatabase(filename: string): Database.Database {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON'); // SQLite defaults FKs OFF; every REFERENCES above is inert without it
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * The lock is a raw `BEGIN IMMEDIATE` / `COMMIT` pair rather than better-sqlite3's
 * `.transaction(fn).immediate()` sugar, because that sugar requires a SYNCHRONOUS
 * callback and `MigrationConnection.withLock`'s `fn` is async (shared with the
 * Postgres adapter). Raw `BEGIN IMMEDIATE` takes the same RESERVED lock at
 * statement one; only the syntax differs, not the locking semantics.
 */
export function createSqliteMigrationConnection(db: Database.Database): MigrationConnection {
  return {
    dialect: 'sqlite',

    async withLock<T>(fn: () => Promise<T>): Promise<T> {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    schemaMigrationsTableExists(): Promise<boolean> {
      const row = db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get();
      return Promise.resolve(row !== undefined);
    },

    getAppliedMigrations(): Promise<readonly AppliedMigration[]> {
      const rows = db
        .prepare<[], AppliedMigration>(`SELECT version, checksum FROM schema_migrations`)
        .all();
      return Promise.resolve(rows);
    },

    applyMigration(migration: Migration, checksum: string, appliedAt: Date): Promise<void> {
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)`,
      ).run(migration.version, checksum, appliedAt.toISOString());
      return Promise.resolve();
    },
  };
}
