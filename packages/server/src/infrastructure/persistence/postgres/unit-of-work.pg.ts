import type pg from 'pg';
import type { Clock } from '../../../application/ports/clock.js';
import type { RepositoryContext, UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { createPostgresAuditLog } from './audit-log.pg.js';
import { createPostgresFlagRepository } from './flag-repository.pg.js';

/** One `PoolClient` checked out for the whole transaction's lifetime. */
export function createPostgresUnitOfWork(pool: pg.Pool, clock: Clock): UnitOfWork {
  return {
    async transact<T>(work: (ctx: RepositoryContext) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ctx: RepositoryContext = {
          flags: createPostgresFlagRepository(client, clock),
          audit: createPostgresAuditLog(client),
        };
        const result = await work(ctx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
