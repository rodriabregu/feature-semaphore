import { randomUUID } from 'node:crypto';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type { AuditAction, AuditEntry, AuditLog } from '../../../application/ports/audit-log.js';
import type { Queryable } from './queryable.js';

interface AuditRowSql {
  actor: string;
  flag_key: string;
  environment: Environment | null;
  action: AuditAction;
  before: unknown;
  after: unknown;
  created_at: Date;
}

function toEntry(row: AuditRowSql): AuditEntry {
  return {
    actor: row.actor,
    flagKey: row.flag_key,
    environment: row.environment,
    action: row.action,
    before: row.before,
    after: row.after,
    createdAt: row.created_at,
  };
}

export function createPostgresAuditLog(db: Queryable): AuditLog {
  return {
    async record(entry: AuditEntry): Promise<void> {
      await db.query(
        `INSERT INTO audit_log (id, actor, flag_key, environment, action, before, after, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          entry.actor,
          entry.flagKey,
          entry.environment,
          entry.action,
          entry.before === null ? null : JSON.stringify(entry.before),
          entry.after === null ? null : JSON.stringify(entry.after),
          entry.createdAt,
        ],
      );
    },

    async findByFlagKey(flagKey: string, limit: number): Promise<readonly AuditEntry[]> {
      const result = await db.query<AuditRowSql>(
        `SELECT * FROM audit_log WHERE flag_key = $1 ORDER BY created_at DESC LIMIT $2`,
        [flagKey, limit],
      );
      return result.rows.map(toEntry);
    },
  };
}
