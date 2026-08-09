import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteApiKeyRepository } from '../../sqlite/api-key-repository.sqlite.js';
import { createSqliteMigrationConnection } from '../../sqlite/connection.js';
import { SQLITE_MIGRATIONS } from '../../migrations/index.js';
import { migrate } from '../../migrations/runner.js';
import { MalformedServerApiKeyError, seedServerKeys } from '../server-key.js';

const RAW_DEV_KEY = `fs_server_${'b'.repeat(43)}`;

describe('seedServerKeys', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    await migrate(createSqliteMigrationConnection(db), SQLITE_MIGRATIONS, () => new Date());
  });

  afterEach(() => {
    db.close();
  });

  it('one env var missing, the other seeded — startup does not fail', async () => {
    const keys = createSqliteApiKeyRepository(db);
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };

    await seedServerKeys(keys, { development: RAW_DEV_KEY, production: undefined }, clock);

    const rows = db.prepare('SELECT kind, environment FROM api_keys').all() as {
      kind: string;
      environment: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('server');
    expect(rows[0]?.environment).toBe('development');
  });

  it('called twice with the same raw key leaves exactly one row', async () => {
    const keys = createSqliteApiKeyRepository(db);
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };

    await seedServerKeys(keys, { development: RAW_DEV_KEY, production: undefined }, clock);
    await seedServerKeys(keys, { development: RAW_DEV_KEY, production: undefined }, clock);

    const rows = db.prepare('SELECT * FROM api_keys').all();
    expect(rows).toHaveLength(1);
  });

  it('stores only the SHA-256 hash, never the raw key', async () => {
    const keys = createSqliteApiKeyRepository(db);
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    await seedServerKeys(keys, { development: RAW_DEV_KEY, production: undefined }, clock);

    const row = db.prepare('SELECT key_hash FROM api_keys').get() as { key_hash: string };
    expect(row.key_hash).toBe(createHash('sha256').update(RAW_DEV_KEY, 'utf8').digest('hex'));
    expect(row.key_hash).not.toContain(RAW_DEV_KEY);
  });

  it('a malformed server key fails startup with a named error and never logs anything', async () => {
    const keys = createSqliteApiKeyRepository(db);
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const logged: string[] = [];
    const log = (line: string): void => {
      logged.push(line);
    };

    await expect(
      seedServerKeys(keys, { development: 'not-a-real-shape', production: undefined }, clock, log),
    ).rejects.toBeInstanceOf(MalformedServerApiKeyError);
    expect(logged).toHaveLength(0);

    const rows = db.prepare('SELECT * FROM api_keys').all();
    expect(rows).toHaveLength(0);
  });

  it('both env vars unset — startup does not fail, nothing is seeded', async () => {
    const keys = createSqliteApiKeyRepository(db);
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };

    await expect(
      seedServerKeys(keys, { development: undefined, production: undefined }, clock),
    ).resolves.toBeUndefined();

    const rows = db.prepare('SELECT * FROM api_keys').all();
    expect(rows).toHaveLength(0);
  });
});
