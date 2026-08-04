import type { AuditLog } from './audit-log.js';
import type { FlagRepository } from './flag-repository.js';

export interface RepositoryContext {
  readonly flags: FlagRepository;
  readonly audit: AuditLog;
}

export interface UnitOfWork {
  transact<T>(work: (ctx: RepositoryContext) => Promise<T>): Promise<T>;
}
