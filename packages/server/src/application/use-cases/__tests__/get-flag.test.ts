import { describe, expect, it } from 'vitest';
import { createMemoryFlagRepository } from '../../../infrastructure/persistence/memory/flag-repository.memory.js';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { NotFoundError } from '../../errors/domain-error.js';
import { createFlag } from '../create-flag.js';
import { getFlag } from '../get-flag.js';

describe('getFlag use case', () => {
  it('returns both environments for an existing flag', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const uow = createMemoryUnitOfWork(db, clock);
    await createFlag(uow, clock, {
      input: { key: 'flag-1', name: 'Flag 1', description: '' },
      actor: 'actor-1',
    });

    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const result = await getFlag(repo, 'flag-1');

    expect(result.environments.development).toBeDefined();
    expect(result.environments.production).toBeDefined();
  });

  it('throws NotFoundError for an unknown key', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);

    await expect(getFlag(repo, 'no-such-flag')).rejects.toBeInstanceOf(NotFoundError);
  });
});
