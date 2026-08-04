import { describe, expect, it } from 'vitest';
import { createMemoryFlagRepository } from '../../../infrastructure/persistence/memory/flag-repository.memory.js';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { createFlag } from '../create-flag.js';
import { archiveFlag } from '../archive-flag.js';

describe('archiveFlag use case', () => {
  it('sets archived_at, writes one audit entry with environment: null, and bumps no config version', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const uow = createMemoryUnitOfWork(db, clock);

    await createFlag(uow, clock, {
      input: { key: 'flag-1', name: 'Flag 1', description: '' },
      actor: 'actor-1',
    });

    await archiveFlag(uow, clock, { key: 'flag-1', actor: 'actor-1' });

    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const aggregate = await repo.findByKey({ flagKey: 'flag-1', environment: 'development' });
    expect(aggregate?.flag.archivedAt).not.toBeNull();
    expect(aggregate?.config.version).toBe(1);

    const entries = db.current.auditLog.filter((e) => e.action === 'flag.archived');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.environment).toBeNull();
  });
});
