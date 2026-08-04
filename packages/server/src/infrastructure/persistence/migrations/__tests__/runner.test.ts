import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteMigrationConnection } from '../../sqlite/connection.js';
import { SQLITE_MIGRATIONS, type Migration } from '../index.js';
import { migrate, MigrationChecksumMismatchError } from '../runner.js';

describe('migration runner (SQLite)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('parses every SQLITE_MIGRATIONS entry against a fresh :memory: database without a syntax error', async () => {
    const conn = createSqliteMigrationConnection(db);
    await expect(migrate(conn, SQLITE_MIGRATIONS, () => new Date())).resolves.toBeUndefined();
  });

  it('running migrate() twice applies each migration exactly once', async () => {
    const conn = createSqliteMigrationConnection(db);
    await migrate(conn, SQLITE_MIGRATIONS, () => new Date());
    await migrate(conn, SQLITE_MIGRATIONS, () => new Date());

    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    expect(rows).toHaveLength(SQLITE_MIGRATIONS.length);
  });

  it('mutating an applied migration checksum aborts the next migrate()', async () => {
    const conn = createSqliteMigrationConnection(db);
    await migrate(conn, SQLITE_MIGRATIONS, () => new Date());

    const mutated: Migration = { version: '001-initial-schema', sql: '-- mutated content --' };

    await expect(migrate(conn, [mutated], () => new Date())).rejects.toBeInstanceOf(
      MigrationChecksumMismatchError,
    );
  });

  it('inserting kind=admin with a non-null environment fails the CHECK constraint', async () => {
    const conn = createSqliteMigrationConnection(db);
    await migrate(conn, SQLITE_MIGRATIONS, () => new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
           VALUES ('id-1', 'admin', 'development', 'hash', '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('inserting kind=server with a null environment fails the CHECK constraint', async () => {
    const conn = createSqliteMigrationConnection(db);
    await migrate(conn, SQLITE_MIGRATIONS, () => new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
           VALUES ('id-2', 'server', NULL, 'hash2', '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('updating an existing admin row to carry a non-null environment fails the CHECK constraint', async () => {
    const conn = createSqliteMigrationConnection(db);
    await migrate(conn, SQLITE_MIGRATIONS, () => new Date());

    db.prepare(
      `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
       VALUES ('id-3', 'admin', NULL, 'hash3', '2026-01-01T00:00:00.000Z')`,
    ).run();

    expect(() =>
      db.prepare(`UPDATE api_keys SET environment = 'development' WHERE id = 'id-3'`).run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('updating an existing server row to a null environment fails the CHECK constraint', async () => {
    const conn = createSqliteMigrationConnection(db);
    await migrate(conn, SQLITE_MIGRATIONS, () => new Date());

    db.prepare(
      `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
       VALUES ('id-4', 'server', 'development', 'hash4', '2026-01-01T00:00:00.000Z')`,
    ).run();

    expect(() =>
      db.prepare(`UPDATE api_keys SET environment = NULL WHERE id = 'id-4'`).run(),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('migration runner (Postgres CHECK, row 8)', () => {
  it('inserting kind=admin with a non-null environment fails the CHECK constraint', async () => {
    const pg = await import('pg');
    const { Client } = pg.default;
    const { createPostgresMigrationConnection } = await import('../../postgres/connection.js');
    const { POSTGRES_MIGRATIONS } = await import('../index.js');

    const schema = `test_runner_${process.pid}`;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);

    try {
      const conn = createPostgresMigrationConnection(client);
      await migrate(conn, POSTGRES_MIGRATIONS, () => new Date());

      await expect(
        client.query(
          `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
           VALUES ('11111111-1111-1111-1111-111111111111', 'admin', 'development', 'hash', now())`,
        ),
      ).rejects.toThrow();

      await client.query(
        `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
         VALUES ('22222222-2222-2222-2222-222222222222', 'admin', NULL, 'hash2', now())`,
      );
      await expect(
        client.query(
          `UPDATE api_keys SET environment = 'development' WHERE id = '22222222-2222-2222-2222-222222222222'`,
        ),
      ).rejects.toThrow();

      await client.query(
        `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
         VALUES ('33333333-3333-3333-3333-333333333333', 'server', 'development', 'hash3', now())`,
      );
      await expect(
        client.query(
          `UPDATE api_keys SET environment = NULL WHERE id = '33333333-3333-3333-3333-333333333333'`,
        ),
      ).rejects.toThrow();
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
});
