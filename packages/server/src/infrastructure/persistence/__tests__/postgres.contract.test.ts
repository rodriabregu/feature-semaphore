import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe } from 'vitest';
import type { Environment } from '@rodriab/feature-semaphore-core';
import { POSTGRES_MIGRATIONS } from '../migrations/index.js';
import { migrate } from '../migrations/runner.js';
import { createPostgresApiKeyRepository } from '../postgres/api-key-repository.pg.js';
import { createPostgresAuditLog } from '../postgres/audit-log.pg.js';
import { createPostgresMigrationConnection } from '../postgres/connection.js';
import { createPostgresFlagRepository } from '../postgres/flag-repository.pg.js';
import { createPostgresUnitOfWork } from '../postgres/unit-of-work.pg.js';
import { describeFlagRepositoryContract, type AdapterHarness } from './flag-repository.contract.js';

const { Pool, Client } = pg;

// Not randomised: `no-restricted-properties` bans `Math.random` repo-wide.
let schemaCounter = 0;

describe.skipIf(!process.env.DATABASE_URL)('postgres', () => {
  const postgresHarness: AdapterHarness = {
    name: 'postgres',
    async create() {
      schemaCounter += 1;
      const schema = `test_${process.pid}_${schemaCounter}`;
      const clock = { now: () => new Date('2026-01-01T00:00:00Z') };

      const bootstrapClient = new Client({ connectionString: process.env.DATABASE_URL });
      await bootstrapClient.connect();
      await bootstrapClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await bootstrapClient.end();

      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path="${schema}"`,
      });

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

      return {
        repo: createPostgresFlagRepository(pool, clock),
        keys: createPostgresApiKeyRepository(pool),
        audit: createPostgresAuditLog(pool),
        uow: createPostgresUnitOfWork(pool, clock),
        clock,
        async insertRawApiKey(row: {
          kind: 'admin' | 'server';
          environment: Environment | null;
        }): Promise<void> {
          await pool.query(
            `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [randomUUID(), row.kind, row.environment, randomUUID(), clock.now()],
          );
        },
        async teardown(): Promise<void> {
          await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          await pool.end();
        },
      };
    },
  };

  describeFlagRepositoryContract(postgresHarness);
});
