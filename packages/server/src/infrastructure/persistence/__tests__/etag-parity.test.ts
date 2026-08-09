import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Environment, FlagDefinition } from '@rodriab/feature-semaphore-core';
import {
  canonicalString,
  definitionsEtag,
  sortDefinitions,
} from '../../http/etag/definitions-etag.js';
import type { FlagRepository, NewFlagConfig } from '../../../application/ports/flag-repository.js';
import { createMemoryFlagRepository } from '../memory/flag-repository.memory.js';
import { MemoryDatabase } from '../memory/store.js';
import { SQLITE_MIGRATIONS, POSTGRES_MIGRATIONS } from '../migrations/index.js';
import { migrate } from '../migrations/runner.js';
import { createSqliteFlagRepository } from '../sqlite/flag-repository.sqlite.js';
import { createSqliteMigrationConnection } from '../sqlite/connection.js';
import { createPostgresFlagRepository } from '../postgres/flag-repository.pg.js';
import { createPostgresMigrationConnection } from '../postgres/connection.js';

const { Pool, Client } = pg;
const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
const ENV: Environment = 'development';

function newConfigs(): readonly NewFlagConfig[] {
  const base = { enabled: true, offValue: false, onValue: true, rolloutPercentage: 0 };
  return [
    { ...base, environment: 'development', salt: 'salt-dev' },
    { ...base, environment: 'production', salt: 'salt-prod' },
  ];
}

async function seedAndComputeEtag(repo: FlagRepository): Promise<string> {
  await repo.createFlag({ key: 'checkout-v2', name: 'checkout-v2', description: '' }, newConfigs());
  await repo.createFlag({ key: 'beta-banner', name: 'beta-banner', description: '' }, newConfigs());
  await repo.replaceRules(
    { flagKey: 'checkout-v2', environment: ENV },
    [{ attribute: 'plan', operator: 'in', values: ['pro', 'team'], serve: true, rollout: 100 }],
    1,
  );
  await repo.replaceOverrides(
    { flagKey: 'checkout-v2', environment: ENV },
    [
      { unitId: 'alice', serve: true },
      { unitId: 'bob', serve: false },
      { unitId: '42', serve: true },
      { unitId: '7', serve: false },
    ],
    2,
  );

  const definitions: readonly FlagDefinition[] = await repo.listDefinitions(ENV);
  return definitionsEtag(canonicalString(sortDefinitions(definitions), ENV));
}

describe('canonical ETag parity across adapters', () => {
  it('memory and SQLite produce an identical ETag for the same seeded data', async () => {
    const memoryDb = new MemoryDatabase();
    const memoryRepo = createMemoryFlagRepository({ get: () => memoryDb.current }, clock);
    const memoryEtag = await seedAndComputeEtag(memoryRepo);

    const sqliteDb = new Database(':memory:');
    sqliteDb.pragma('foreign_keys = ON');
    await migrate(createSqliteMigrationConnection(sqliteDb), SQLITE_MIGRATIONS, clock.now);
    const sqliteRepo = createSqliteFlagRepository(sqliteDb, clock);
    const sqliteEtag = await seedAndComputeEtag(sqliteRepo);
    sqliteDb.close();

    expect(sqliteEtag).toBe(memoryEtag);
  });

  describe.skipIf(!process.env.DATABASE_URL)('postgres leg', () => {
    let schema: string;

    afterAll(async () => {
      if (!schema) return;
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    it('postgres produces an identical ETag to memory for the same seeded data', async () => {
      const memoryDb = new MemoryDatabase();
      const memoryRepo = createMemoryFlagRepository({ get: () => memoryDb.current }, clock);
      const memoryEtag = await seedAndComputeEtag(memoryRepo);

      schema = `etag_parity_${process.pid}_${randomUUID().replace(/-/g, '')}`;
      const bootstrapClient = new Client({ connectionString: process.env.DATABASE_URL });
      await bootstrapClient.connect();
      await bootstrapClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await bootstrapClient.end();

      const migrationClient = new Client({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path="${schema}"`,
      });
      await migrationClient.connect();
      await migrate(
        createPostgresMigrationConnection(migrationClient),
        POSTGRES_MIGRATIONS,
        clock.now,
      );
      await migrationClient.end();

      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path="${schema}"`,
      });
      const postgresRepo = createPostgresFlagRepository(pool, clock);
      const postgresEtag = await seedAndComputeEtag(postgresRepo);
      await pool.end();

      expect(postgresEtag).toBe(memoryEtag);
    });
  });
});
