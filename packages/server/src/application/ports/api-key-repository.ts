import type { Environment } from '@rodriab/feature-semaphore-core';

export interface ApiKeyRecord {
  readonly id: string;
  readonly kind: 'admin' | 'server';
  /**
   * NULL for every `admin` row, NON-NULL for every `server` row, enforced by a DB
   * CHECK. An admin key is global, so there is no admin environment to scope. This
   * field exists for the Phase 3 SDK API, where the environment IS derived from the
   * key. NO management route in this phase reads it.
   */
  readonly environment: Environment | null;
}

export interface ApiKeyRepository {
  findByHash(sha256Hex: string): Promise<ApiKeyRecord | null>;
  /** Conditional and idempotent; a no-op when last_used_at >= staleBefore. */
  touch(id: string, at: Date, staleBefore: Date): Promise<void>;
  /** Idempotent upsert of the env-var admin key at startup. */
  ensureAdminKey(sha256Hex: string, at: Date): Promise<void>;

  /**
   * Idempotent upsert of an env-var server key, bound to exactly one
   * environment. Idempotent by `key_hash`, mirroring `ensureAdminKey`.
   */
  ensureServerKey(sha256Hex: string, environment: Environment, at: Date): Promise<void>;
}
