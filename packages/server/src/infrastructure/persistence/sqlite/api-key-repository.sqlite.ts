import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
} from '../../../application/ports/api-key-repository.js';

interface ApiKeyRow {
  readonly id: string;
  readonly kind: 'admin' | 'server';
  readonly environment: string | null;
}

export function createSqliteApiKeyRepository(db: Database.Database): ApiKeyRepository {
  return {
    async findByHash(sha256Hex: string): Promise<ApiKeyRecord | null> {
      const row = db
        .prepare<[string], ApiKeyRow>(
          'SELECT id, kind, environment FROM api_keys WHERE key_hash = ?',
        )
        .get(sha256Hex);
      if (!row) return Promise.resolve(null);
      return Promise.resolve({
        id: row.id,
        kind: row.kind,
        environment: row.environment as Environment | null,
      });
    },

    async touch(id: string, at: Date, staleBefore: Date): Promise<void> {
      db.prepare(
        `UPDATE api_keys SET last_used_at = ?
          WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
      ).run(at.toISOString(), id, staleBefore.toISOString());
      return Promise.resolve();
    },

    async ensureAdminKey(sha256Hex: string, at: Date): Promise<void> {
      db.prepare(
        `INSERT OR IGNORE INTO api_keys (id, kind, environment, key_hash, created_at)
         VALUES (?, 'admin', NULL, ?, ?)`,
      ).run(randomUUID(), sha256Hex, at.toISOString());
      return Promise.resolve();
    },
  };
}
