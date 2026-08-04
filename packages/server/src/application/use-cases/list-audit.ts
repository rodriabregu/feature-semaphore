import type { AuditEntry, AuditLog } from '../ports/audit-log.js';

/** Read-only, newest first, bounded by `limit`. */
export function listAudit(
  audit: AuditLog,
  key: string,
  limit: number,
): Promise<readonly AuditEntry[]> {
  return audit.findByFlagKey(key, limit);
}
