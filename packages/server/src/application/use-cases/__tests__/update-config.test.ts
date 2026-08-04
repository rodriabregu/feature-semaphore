import { describe, expect, it } from 'vitest';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { createMemoryFlagRepository } from '../../../infrastructure/persistence/memory/flag-repository.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { NotFoundError, VersionConflictError } from '../../errors/domain-error.js';
import { createFlag } from '../create-flag.js';
import { updateConfig } from '../update-config.js';

function testHarness(): {
  uow: ReturnType<typeof createMemoryUnitOfWork>;
  db: MemoryDatabase;
  clock: { now: () => Date };
} {
  const db = new MemoryDatabase();
  const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  return { db, clock, uow: createMemoryUnitOfWork(db, clock) };
}

describe('updateConfig use case', () => {
  it('a stale expectedVersion throws VersionConflictError and leaves the stored version unchanged', async () => {
    const { uow, clock, db } = testHarness();
    await createFlag(uow, clock, {
      input: { key: 'flag-1', name: 'Flag 1', description: '' },
      actor: 'actor-1',
    });

    await expect(
      updateConfig(uow, clock, {
        ref: { flagKey: 'flag-1', environment: 'development' },
        patch: { enabled: true },
        expectedVersion: 99,
        actor: 'actor-1',
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);

    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const aggregate = await repo.findByKey({ flagKey: 'flag-1', environment: 'development' });
    expect(aggregate?.config.version).toBe(1);
  });

  it('updateConfig against a key with no config row throws NotFoundError, not VersionConflictError', async () => {
    const { uow, clock } = testHarness();

    await expect(
      updateConfig(uow, clock, {
        ref: { flagKey: 'no-such-flag', environment: 'development' },
        patch: { enabled: true },
        expectedVersion: 1,
        actor: 'actor-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('an audit write that rejects rolls the whole mutation back — version unchanged, config unmodified', async () => {
    const { uow, clock, db } = testHarness();
    await createFlag(uow, clock, {
      input: { key: 'flag-2', name: 'Flag 2', description: '' },
      actor: 'actor-1',
    });

    // Simulate an audit failure the same way the contract suite does: throw
    // inside the transaction after the repository mutation has happened.
    await expect(
      uow.transact(async (ctx) => {
        await ctx.flags.updateConfig(
          { flagKey: 'flag-2', environment: 'development' },
          { enabled: true },
          1,
        );
        throw new Error('audit write failed');
      }),
    ).rejects.toThrow('audit write failed');

    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const aggregate = await repo.findByKey({ flagKey: 'flag-2', environment: 'development' });
    expect(aggregate?.config.version).toBe(1);
    expect(aggregate?.config.enabled).toBe(false);
  });

  it("bumping production's version leaves development's untouched", async () => {
    const { uow, clock, db } = testHarness();
    await createFlag(uow, clock, {
      input: { key: 'flag-3', name: 'Flag 3', description: '' },
      actor: 'actor-1',
    });

    await updateConfig(uow, clock, {
      ref: { flagKey: 'flag-3', environment: 'production' },
      patch: { enabled: true },
      expectedVersion: 1,
      actor: 'actor-1',
    });

    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const production = await repo.findByKey({ flagKey: 'flag-3', environment: 'production' });
    const development = await repo.findByKey({ flagKey: 'flag-3', environment: 'development' });
    expect(production?.config.version).toBe(2);
    expect(development?.config.version).toBe(1);
  });

  it('happy path records one audit entry with the config-scoped environment', async () => {
    const { uow, clock, db } = testHarness();
    await createFlag(uow, clock, {
      input: { key: 'flag-4', name: 'Flag 4', description: '' },
      actor: 'actor-1',
    });

    const result = await updateConfig(uow, clock, {
      ref: { flagKey: 'flag-4', environment: 'development' },
      patch: { enabled: true },
      expectedVersion: 1,
      actor: 'actor-1',
    });

    expect(result.version).toBe(2);
    const entry = db.current.auditLog.find((e) => e.action === 'config.updated');
    expect(entry?.environment).toBe('development');
  });
});
