import { describe, expect, it } from 'vitest';
import { createMemoryFlagRepository } from '../../../infrastructure/persistence/memory/flag-repository.memory.js';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { createFlag } from '../create-flag.js';
import { replaceOverrides } from '../replace-overrides.js';

describe('replaceOverrides use case', () => {
  it('replacing with [] removes every override and still bumps the version', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const uow = createMemoryUnitOfWork(db, clock);

    await createFlag(uow, clock, {
      input: { key: 'flag-1', name: 'Flag 1', description: '' },
      actor: 'actor-1',
    });

    await replaceOverrides(uow, clock, {
      ref: { flagKey: 'flag-1', environment: 'development' },
      overrides: [{ unitId: 'user-1', serve: true }],
      expectedVersion: 1,
      actor: 'actor-1',
    });

    const result = await replaceOverrides(uow, clock, {
      ref: { flagKey: 'flag-1', environment: 'development' },
      overrides: [],
      expectedVersion: 2,
      actor: 'actor-1',
    });

    expect(result.version).toBe(3);
    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const aggregate = await repo.findByKey({ flagKey: 'flag-1', environment: 'development' });
    expect(aggregate?.overrides).toHaveLength(0);
  });
});
