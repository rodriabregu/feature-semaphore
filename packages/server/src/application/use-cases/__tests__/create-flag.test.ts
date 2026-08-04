import { describe, expect, it } from 'vitest';
import { createMemoryApiKeyRepository } from '../../../infrastructure/persistence/memory/api-key-repository.memory.js';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import type { AuditEntry } from '../../ports/audit-log.js';
import { createFlag } from '../create-flag.js';

function testHarness(): {
  uow: ReturnType<typeof createMemoryUnitOfWork>;
  db: MemoryDatabase;
  clock: { now: () => Date };
} {
  const db = new MemoryDatabase();
  const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  return { db, clock, uow: createMemoryUnitOfWork(db, clock) };
}

describe('createFlag use case', () => {
  it('sets on_value: true explicitly in both configs and in the audit after snapshot', async () => {
    const { uow, db, clock } = testHarness();
    const keys = createMemoryApiKeyRepository({ get: () => db.current });
    await keys.ensureAdminKey('actor-hash', clock.now());
    const actor = await keys.findByHash('actor-hash');

    const result = await createFlag(uow, clock, {
      input: { key: 'checkout-v2', name: 'Checkout v2', description: '' },
      actor: actor?.id ?? 'unknown-actor',
    });

    expect(result.environments.development.config.onValue).toBe(true);
    expect(result.environments.production.config.onValue).toBe(true);

    const auditEntry = db.current.auditLog.at(0) as AuditEntry | undefined;
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.action).toBe('flag.created');
    expect(auditEntry?.before).toBeNull();
    const after = auditEntry?.after as typeof result;
    expect(after.environments.development.config.onValue).toBe(true);
    expect(after.environments.production.config.onValue).toBe(true);
  });

  it('writes exactly one flag-scoped audit entry (environment: null)', async () => {
    const { uow, clock, db } = testHarness();

    await createFlag(uow, clock, {
      input: { key: 'flag-x', name: 'Flag X', description: '' },
      actor: 'actor-1',
    });

    expect(db.current.auditLog).toHaveLength(1);
    expect(db.current.auditLog[0]?.environment).toBeNull();
  });

  it('generates a distinct salt per environment', async () => {
    const { uow, clock } = testHarness();

    const result = await createFlag(uow, clock, {
      input: { key: 'flag-y', name: 'Flag Y', description: '' },
      actor: 'actor-1',
    });

    expect(result.environments.development.config.salt).not.toBe(
      result.environments.production.config.salt,
    );
  });
});
