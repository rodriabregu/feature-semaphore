import { randomUUID } from 'node:crypto';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
} from '../../../application/ports/api-key-repository.js';
import type { Queryable } from './queryable.js';

interface ApiKeyRowSql {
  id: string;
  kind: 'admin' | 'server';
  environment: Environment | null;
}

export function createPostgresApiKeyRepository(db: Queryable): ApiKeyRepository {
  return {
    async findByHash(sha256Hex: string): Promise<ApiKeyRecord | null> {
      const result = await db.query<ApiKeyRowSql>(
        `SELECT id, kind, environment FROM api_keys WHERE key_hash = $1`,
        [sha256Hex],
      );
      const row = result.rows.at(0);
      return row ? { id: row.id, kind: row.kind, environment: row.environment } : null;
    },

    async touch(id: string, at: Date, staleBefore: Date): Promise<void> {
      await db.query(
        `UPDATE api_keys SET last_used_at = $2
          WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $3)`,
        [id, at, staleBefore],
      );
    },

    async ensureAdminKey(sha256Hex: string, at: Date): Promise<void> {
      await db.query(
        `INSERT INTO api_keys (id, kind, environment, key_hash, created_at)
         VALUES ($1, 'admin', NULL, $2, $3)
         ON CONFLICT (key_hash) DO NOTHING`,
        [randomUUID(), sha256Hex, at],
      );
    },
  };
}
