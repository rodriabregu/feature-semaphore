import type { Clock } from '../../../application/ports/clock.js';
import type { RepositoryContext, UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { createMemoryAuditLog } from './audit-log.memory.js';
import { createMemoryFlagRepository } from './flag-repository.memory.js';
import type { MemoryDatabase } from './store.js';

/**
 * Real rollback via copy-on-write: `transact` deep-clones the store, runs the body
 * against the clone, swaps the live store on success, discards the clone on throw.
 * Without this, "a failing audit write leaves no flag behind" would be untestable
 * on the memory adapter, and a suite that skips a case per adapter no longer
 * proves parity.
 */
export function createMemoryUnitOfWork(db: MemoryDatabase, clock: Clock): UnitOfWork {
  return {
    async transact<T>(work: (ctx: RepositoryContext) => Promise<T>): Promise<T> {
      const draft = structuredClone(db.current);
      const ctx: RepositoryContext = {
        flags: createMemoryFlagRepository({ get: () => draft }, clock),
        audit: createMemoryAuditLog({ get: () => draft }),
      };

      const result = await work(ctx);
      db.current = draft; // commit — only reached if `work` did not throw
      return result;
    },
  };
}
