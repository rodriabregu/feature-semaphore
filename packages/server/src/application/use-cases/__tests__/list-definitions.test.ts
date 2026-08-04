import { describe, expect, it } from 'vitest';
import { createMemoryFlagRepository } from '../../../infrastructure/persistence/memory/flag-repository.memory.js';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { archiveFlag } from '../archive-flag.js';
import { createFlag } from '../create-flag.js';
import { listDefinitions } from '../list-definitions.js';

describe('listDefinitions use case', () => {
  it('an archived flag is returned with archived: true, not filtered out', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const uow = createMemoryUnitOfWork(db, clock);
    await createFlag(uow, clock, {
      input: { key: 'flag-1', name: 'Flag 1', description: '' },
      actor: 'actor-1',
    });
    await archiveFlag(uow, clock, { key: 'flag-1', actor: 'actor-1' });

    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const definitions = await listDefinitions(repo, 'development');

    const found = definitions.find((d) => d.key === 'flag-1');
    expect(found).toBeDefined();
    expect(found?.archived).toBe(true);
  });
});
