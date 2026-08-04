import { createHash } from 'node:crypto';
import type { ApiKeyRepository } from '../../../application/ports/api-key-repository.js';
import type { Clock } from '../../../application/ports/clock.js';

const ADMIN_KEY_SHAPE = /^fs_admin_[A-Za-z0-9_-]{43}$/;

export class MissingAdminApiKeyError extends Error {
  constructor() {
    super(
      'ADMIN_API_KEY must be set: without it there is no authenticable path to the management API',
    );
    this.name = 'MissingAdminApiKeyError';
  }
}

export class MalformedAdminApiKeyError extends Error {
  constructor() {
    super('ADMIN_API_KEY does not match the required fs_admin_<csprng> shape');
    this.name = 'MalformedAdminApiKeyError';
  }
}

/**
 * Idempotent by `key_hash` (the adapter's `ensureAdminKey` upserts). Must be called
 * AFTER `migrate()` and inside the same startup lock, so two instances cannot race
 * the insert. The raw key is validated then hashed; it is never logged, not even on
 * failure — `log` receives no argument derived from `rawKey`.
 * @throws MissingAdminApiKeyError    when `rawKey` is unset — startup must fail fast.
 * @throws MalformedAdminApiKeyError  when `rawKey` does not match the admin key shape.
 */
export async function seedAdminKey(
  keys: ApiKeyRepository,
  rawKey: string | undefined,
  clock: Clock,
  log?: (line: string) => void,
): Promise<void> {
  if (!rawKey) {
    throw new MissingAdminApiKeyError();
  }
  if (!ADMIN_KEY_SHAPE.test(rawKey)) {
    throw new MalformedAdminApiKeyError();
  }

  const hash = createHash('sha256').update(rawKey, 'utf8').digest('hex');
  await keys.ensureAdminKey(hash, clock.now());
  log?.('admin key seeded');
}
