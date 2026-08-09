import { randomUUID } from 'node:crypto';
import type { Environment } from '@rodriab/feature-semaphore-core';
import { createMemoryApiKeyRepository } from '../memory/api-key-repository.memory.js';
import { createMemoryAuditLog } from '../memory/audit-log.memory.js';
import { createMemoryExposureRepository } from '../memory/exposure-repository.memory.js';
import { createMemoryFlagRepository } from '../memory/flag-repository.memory.js';
import { MemoryDatabase } from '../memory/store.js';
import { createMemoryUnitOfWork } from '../memory/unit-of-work.memory.js';
import { describeFlagRepositoryContract, type AdapterHarness } from './flag-repository.contract.js';

const memoryHarness: AdapterHarness = {
  name: 'memory',
  create() {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const store = { get: () => db.current };

    return Promise.resolve({
      repo: createMemoryFlagRepository(store, clock),
      keys: createMemoryApiKeyRepository(store),
      audit: createMemoryAuditLog(store),
      uow: createMemoryUnitOfWork(db, clock),
      exposures: createMemoryExposureRepository(store),
      countExposureRows(): Promise<number> {
        return Promise.resolve(db.current.exposures.length);
      },
      clock,
      insertRawApiKey(row: {
        kind: 'admin' | 'server';
        environment: Environment | null;
      }): Promise<void> {
        // No CHECK constraint exists in memory, so the invariant is enforced in
        // code — the same invariant the DB CHECK expresses for SQLite/Postgres.
        const violatesInvariant =
          (row.kind === 'admin' && row.environment !== null) ||
          (row.kind === 'server' && row.environment === null);
        if (violatesInvariant) {
          return Promise.reject(
            new Error('api_keys_environment_only_for_server invariant violated'),
          );
        }
        db.current.apiKeys.push({
          id: randomUUID(),
          kind: row.kind,
          environment: row.environment,
          keyHash: randomUUID(),
          createdAt: clock.now(),
          lastUsedAt: null,
        });
        return Promise.resolve();
      },
      teardown(): Promise<void> {
        return Promise.resolve();
      },
    });
  },
};

describeFlagRepositoryContract(memoryHarness);
