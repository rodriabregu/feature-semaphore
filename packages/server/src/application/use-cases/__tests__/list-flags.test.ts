import { describe, expect, it } from 'vitest';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { createMemoryFlagRepository } from '../../../infrastructure/persistence/memory/flag-repository.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { createFlag } from '../create-flag.js';
import { listFlags } from '../list-flags.js';

describe('listFlags use case', () => {
  it('every returned flag carries both development and production blocks', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const uow = createMemoryUnitOfWork(db, clock);
    await createFlag(uow, clock, {
      input: { key: 'flag-1', name: 'Flag 1', description: '' },
      actor: 'actor-1',
    });

    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const result = await listFlags(repo);

    expect(result).toHaveLength(1);
    expect(result[0]?.environments.development).toBeDefined();
    expect(result[0]?.environments.production).toBeDefined();
  });
});
