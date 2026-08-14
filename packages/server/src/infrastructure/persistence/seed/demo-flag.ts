import type { Environment } from '@rodriab/feature-semaphore-core';
import { DuplicateKeyError } from '../../../application/errors/domain-error.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { FlagRepository, NewFlagConfig } from '../../../application/ports/flag-repository.js';

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

export const DEMO_FLAG_KEY = 'checkout-v2';

/**
 * Seeds one demo flag so a fresh `docker compose up` has something to show.
 * Gated on `SEED_DEMO_FLAG === 'true'` so it never fires in a non-demo
 * deployment — a self-hoster's real dataset must never gain a flag nobody
 * asked for. Idempotent by `key`: `findAllEnvironmentsByKey` short-circuits
 * the common case, and `createFlag`'s own `DuplicateKeyError` is swallowed
 * as a belt-and-braces guard against a race between two instances seeding at
 * once. Mirrors `seed/admin-key.ts:31-47`'s upsert-idempotency posture.
 */
export async function seedDemoFlag(repo: FlagRepository, clock: Clock): Promise<void> {
  // `clock` is unused today — kept for signature parity with `seedAdminKey`/
  // `seedServerKeys`, both of which need it for `ensureAdminKey`/
  // `ensureServerKey`'s upsert timestamp. `FlagRepository.createFlag` sets
  // its own timestamps internally, so there is nothing to pass it here yet.
  void clock;

  if (process.env.SEED_DEMO_FLAG !== 'true') {
    return;
  }

  const existing = await repo.findAllEnvironmentsByKey(DEMO_FLAG_KEY);
  if (existing) {
    return;
  }

  const configs: readonly NewFlagConfig[] = ENVIRONMENTS.map((environment) => ({
    environment,
    enabled: true,
    offValue: false,
    onValue: true,
    rolloutPercentage: environment === 'development' ? 100 : 50,
    salt: 'demo-flag-fixed-salt', // fixed on purpose: a deterministic demo, never a real secret
  }));

  try {
    await repo.createFlag(
      { key: DEMO_FLAG_KEY, name: 'Checkout v2', description: 'Seeded demo flag' },
      configs,
    );
  } catch (error) {
    if (error instanceof DuplicateKeyError) {
      return;
    }
    throw error;
  }
}
