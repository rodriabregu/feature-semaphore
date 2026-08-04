import { randomUUID } from 'node:crypto';
import type { AuditEntry, AuditLog } from '../../../application/ports/audit-log.js';
import type { StoreAccessor } from './store.js';

export function createMemoryAuditLog(store: StoreAccessor): AuditLog {
  return {
    async record(entry: AuditEntry): Promise<void> {
      store.get().auditLog.push({ id: randomUUID(), ...entry });
      return Promise.resolve();
    },

    async findByFlagKey(flagKey: string, limit: number): Promise<readonly AuditEntry[]> {
      const rows = store
        .get()
        .auditLog.filter((entry) => entry.flagKey === flagKey)
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
      return Promise.resolve(rows);
    },
  };
}
