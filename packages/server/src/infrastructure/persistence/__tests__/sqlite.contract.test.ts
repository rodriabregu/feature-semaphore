import Database from 'better-sqlite3';
import type { Environment } from '@rodriab/feature-semaphore-core';
import { SQLITE_MIGRATIONS } from '../migrations/index.js';
import { migrate } from '../migrations/runner.js';
import { createSqliteApiKeyRepository } from '../sqlite/api-key-repository.sqlite.js';
import { createSqliteAuditLog } from '../sqlite/audit-log.sqlite.js';
import { createSqliteExposureRepository } from '../sqlite/exposure-repository.sqlite.js';
import { createSqliteMigrationConnection } from '../sqlite/connection.js';
import { createSqliteFlagRepository } from '../sqlite/flag-repository.sqlite.js';
import { createSqliteUnitOfWork } from '../sqlite/unit-of-work.sqlite.js';
import { describeFlagRepositoryContract, type AdapterHarness } from './flag-repository.contract.js';
import { randomUUID } from 'node:crypto';

const sqliteHarness: AdapterHarness = {
  name: 'sqlite',
  async create() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };

    await migrate(createSqliteMigrationConnection(db), SQLITE_MIGRATIONS, clock.now);

    return {
      repo: createSqliteFlagRepository(db, clock),
      keys: createSqliteApiKeyRepository(db),
      audit: createSqliteAuditLog(db),
      uow: createSqliteUnitOfWork(db, clock),
      exposures: createSqliteExposureRepository(db),
      countExposureRows(): Promise<number> {
        const row = db.prepare('SELECT COUNT(*) AS n FROM exposures').get() as { n: number };
        return Promise.resolve(row.n);
      },
      clock,
      insertRawApiKey(row: {
        kind: 'admin' | 'server';
        environment: Environment | null;
      }): Promise<void> {
        return new Promise((resolve, reject) => {
          try {
            db.prepare(
              `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(randomUUID(), row.kind, row.environment, randomUUID(), clock.now().toISOString());
            resolve();
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
      teardown(): Promise<void> {
        db.close();
        return Promise.resolve();
      },
    };
  },
};

describeFlagRepositoryContract(sqliteHarness);
