import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type { AuditAction, AuditEntry, AuditLog } from '../../../application/ports/audit-log.js';

interface AuditRowSql {
  actor: string;
  flag_key: string;
  environment: Environment | null;
  action: AuditAction;
  before: string | null;
  after: string | null;
  created_at: string;
}

function toEntry(row: AuditRowSql): AuditEntry {
  return {
    actor: row.actor,
    flagKey: row.flag_key,
    environment: row.environment,
    action: row.action,
    before: row.before === null ? null : (JSON.parse(row.before) as unknown),
    after: row.after === null ? null : (JSON.parse(row.after) as unknown),
    createdAt: new Date(row.created_at),
  };
}

export function createSqliteAuditLog(db: Database.Database): AuditLog {
  return {
    async record(entry: AuditEntry): Promise<void> {
      db.prepare(
        `INSERT INTO audit_log (id, actor, flag_key, environment, action, before, after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        entry.actor,
        entry.flagKey,
        entry.environment,
        entry.action,
        entry.before === null ? null : JSON.stringify(entry.before),
        entry.after === null ? null : JSON.stringify(entry.after),
        entry.createdAt.toISOString(),
      );
      return Promise.resolve();
    },

    async findByFlagKey(flagKey: string, limit: number): Promise<readonly AuditEntry[]> {
      const rows = db
        .prepare<[string, number], AuditRowSql>(
          `SELECT * FROM audit_log WHERE flag_key = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(flagKey, limit);
      return Promise.resolve(rows.map(toEntry));
    },
  };
}
