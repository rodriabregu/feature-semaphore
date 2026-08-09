import { createHash } from 'node:crypto';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type { ApiKeyRepository } from '../../../application/ports/api-key-repository.js';
import type { Clock } from '../../../application/ports/clock.js';

const SERVER_KEY_SHAPE = /^fs_server_[A-Za-z0-9_-]{43}$/;

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

export class MalformedServerApiKeyError extends Error {
  constructor(readonly environment: Environment) {
    super(
      `SERVER_API_KEY_${environment.toUpperCase()} does not match the required fs_server_<csprng> shape`,
    );
    this.name = 'MalformedServerApiKeyError';
  }
}

/**
 * Mirrors `seedAdminKey`, with one deliberate asymmetry: the SDK API is
 * optional per environment, so an UNSET env var is tolerated — logged, not
 * fatal. A SET but malformed value still fails startup, exactly like the
 * admin key, because a silently-unauthenticable typo'd credential is the
 * worse failure mode. Idempotent by `key_hash` (the adapter's
 * `ensureServerKey` upserts). Must be called AFTER `migrate()` and inside the
 * same startup lock as `seedAdminKey`. Never logs the raw key.
 * @throws MalformedServerApiKeyError when a SET raw key fails the shape check.
 */
export async function seedServerKeys(
  keys: ApiKeyRepository,
  rawKeys: Readonly<Record<Environment, string | undefined>>,
  clock: Clock,
  log?: (line: string) => void,
): Promise<void> {
  for (const environment of ENVIRONMENTS) {
    const rawKey = rawKeys[environment];
    if (!rawKey) {
      log?.(`SERVER_API_KEY_${environment.toUpperCase()} is unset — skipping ${environment}`);
      continue;
    }
    if (!SERVER_KEY_SHAPE.test(rawKey)) {
      throw new MalformedServerApiKeyError(environment);
    }

    const hash = createHash('sha256').update(rawKey, 'utf8').digest('hex');
    await keys.ensureServerKey(hash, environment, clock.now());
    log?.(`${environment} server key seeded`);
  }
}
