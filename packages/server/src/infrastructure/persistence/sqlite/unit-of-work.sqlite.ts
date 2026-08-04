import type Database from 'better-sqlite3';
import type { Clock } from '../../../application/ports/clock.js';
import type { RepositoryContext, UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { createSqliteAuditLog } from './audit-log.sqlite.js';
import { createSqliteFlagRepository } from './flag-repository.sqlite.js';

/**
 * Raw `BEGIN` / `COMMIT` / `ROLLBACK` rather than `.transaction(fn)`, because that
 * helper requires a synchronous callback and `fn` here is async (shared shape with
 * the Postgres adapter). better-sqlite3 has one connection and is single-threaded,
 * so every statement `work` issues through `ctx.flags`/`ctx.audit` naturally
 * participates in this same transaction.
 */
export function createSqliteUnitOfWork(db: Database.Database, clock: Clock): UnitOfWork {
  return {
    async transact<T>(work: (ctx: RepositoryContext) => Promise<T>): Promise<T> {
      db.exec('BEGIN');
      const ctx: RepositoryContext = {
        flags: createSqliteFlagRepository(db, clock),
        audit: createSqliteAuditLog(db),
      };
      try {
        const result = await work(ctx);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
