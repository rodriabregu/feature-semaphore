import type { Environment } from '@rodriab/feature-semaphore-core';

export type AuditAction =
  'flag.created' | 'config.updated' | 'rules.replaced' | 'overrides.replaced' | 'flag.archived';

export interface AuditEntry {
  readonly actor: string; // api_keys.id — never the key, never its hash
  readonly flagKey: string;
  readonly environment: Environment | null; // null for flag-scoped actions
  readonly action: AuditAction;
  readonly before: unknown; // full snapshot, null on create
  readonly after: unknown;
  readonly createdAt: Date; // from Clock, not from the DB
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  /**
   * Newest first, bounded by `limit`. Added beyond Part 1's port sketch: the
   * `listAudit` use case and `GET /flags/:key/audit` require a read path, and
   * `record`-only left that requirement unimplementable. Per the design's own
   * second inherited rule, an unimplementable requirement is a design gap to
   * fix, not a carve-out to document around.
   */
  findByFlagKey(flagKey: string, limit: number): Promise<readonly AuditEntry[]>;
}
