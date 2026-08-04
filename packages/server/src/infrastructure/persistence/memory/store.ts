import type { Environment } from '@rodriab/feature-semaphore-core';
import type { AuditAction } from '../../../application/ports/audit-log.js';

export interface MemoryFlagRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  archivedAt: Date | null;
}

export interface MemoryConfigRow {
  readonly id: string;
  readonly flagId: string;
  readonly environment: Environment;
  enabled: boolean;
  offValue: boolean;
  onValue: boolean;
  rolloutPercentage: number;
  readonly salt: string;
  version: number;
  updatedAt: Date;
}

export interface MemoryRuleRow {
  readonly id: string;
  readonly flagConfigId: string;
  readonly position: number;
  readonly attribute: string;
  readonly operator: string;
  readonly values: unknown;
  readonly serve: boolean;
  readonly rollout: number;
}

export interface MemoryOverrideRow {
  readonly id: string;
  readonly flagConfigId: string;
  readonly unitId: string;
  readonly serve: boolean;
}

export interface MemoryApiKeyRow {
  readonly id: string;
  readonly kind: 'admin' | 'server';
  readonly environment: Environment | null;
  readonly keyHash: string;
  readonly createdAt: Date;
  lastUsedAt: Date | null;
}

export interface MemoryAuditRow {
  readonly id: string;
  readonly actor: string;
  readonly flagKey: string;
  readonly environment: Environment | null;
  readonly action: AuditAction;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: Date;
}

export interface MemoryStore {
  flags: MemoryFlagRow[];
  configs: MemoryConfigRow[];
  rules: MemoryRuleRow[];
  overrides: MemoryOverrideRow[];
  apiKeys: MemoryApiKeyRow[];
  auditLog: MemoryAuditRow[];
}

export function createEmptyStore(): MemoryStore {
  return { flags: [], configs: [], rules: [], overrides: [], apiKeys: [], auditLog: [] };
}

/** A mutable cell holding the currently-committed store, swapped atomically by the UnitOfWork. */
export class MemoryDatabase {
  current: MemoryStore = createEmptyStore();
}

/** Indirection so repository code is identical whether bound to the live store or a
 * transaction's copy-on-write draft. */
export interface StoreAccessor {
  get(): MemoryStore;
}
