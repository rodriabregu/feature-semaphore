import { randomUUID } from 'node:crypto';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
} from '../../../application/ports/api-key-repository.js';
import type { StoreAccessor } from './store.js';

export function createMemoryApiKeyRepository(store: StoreAccessor): ApiKeyRepository {
  return {
    async findByHash(sha256Hex: string): Promise<ApiKeyRecord | null> {
      const row = store.get().apiKeys.find((k) => k.keyHash === sha256Hex);
      return Promise.resolve(
        row ? { id: row.id, kind: row.kind, environment: row.environment } : null,
      );
    },

    async touch(id: string, at: Date, staleBefore: Date): Promise<void> {
      const row = store.get().apiKeys.find((k) => k.id === id);
      if (row && (row.lastUsedAt === null || row.lastUsedAt < staleBefore)) {
        row.lastUsedAt = at;
      }
      return Promise.resolve();
    },

    async ensureAdminKey(sha256Hex: string, at: Date): Promise<void> {
      const s = store.get();
      if (s.apiKeys.some((k) => k.keyHash === sha256Hex)) {
        return Promise.resolve();
      }
      s.apiKeys.push({
        id: randomUUID(),
        kind: 'admin',
        environment: null,
        keyHash: sha256Hex,
        createdAt: at,
        lastUsedAt: null,
      });
      return Promise.resolve();
    },

    async ensureServerKey(sha256Hex: string, environment: Environment, at: Date): Promise<void> {
      const s = store.get();
      if (s.apiKeys.some((k) => k.keyHash === sha256Hex)) {
        return Promise.resolve();
      }
      s.apiKeys.push({
        id: randomUUID(),
        kind: 'server',
        environment,
        keyHash: sha256Hex,
        createdAt: at,
        lastUsedAt: null,
      });
      return Promise.resolve();
    },
  };
}
