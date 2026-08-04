import { describe, expect, it } from 'vitest';
import { createMemoryFlagRepository } from '../../../infrastructure/persistence/memory/flag-repository.memory.js';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { createFlag } from '../create-flag.js';
import { replaceRules } from '../replace-rules.js';

describe('replaceRules use case', () => {
  it('submitted array order becomes position 0..n-1, and the previous set is gone', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const uow = createMemoryUnitOfWork(db, clock);

    await createFlag(uow, clock, {
      input: { key: 'flag-1', name: 'Flag 1', description: '' },
      actor: 'actor-1',
    });

    await replaceRules(uow, clock, {
      ref: { flagKey: 'flag-1', environment: 'development' },
      rules: [
        { attribute: 'c', operator: 'in', values: ['x'], serve: true, rollout: 100 },
        { attribute: 'a', operator: 'in', values: ['x'], serve: true, rollout: 100 },
      ],
      expectedVersion: 1,
      actor: 'actor-1',
    });

    const result = await replaceRules(uow, clock, {
      ref: { flagKey: 'flag-1', environment: 'development' },
      rules: [{ attribute: 'z', operator: 'in', values: ['x'], serve: true, rollout: 100 }],
      expectedVersion: 2,
      actor: 'actor-1',
    });

    expect(result.version).toBe(3);
    const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
    const aggregate = await repo.findByKey({ flagKey: 'flag-1', environment: 'development' });
    expect(aggregate?.rules.map((r) => r.attribute)).toEqual(['z']);
    expect(aggregate?.rules.map((r) => r.position)).toEqual([0]);
  });

  it('writes one audit entry with action rules.replaced', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const uow = createMemoryUnitOfWork(db, clock);
    await createFlag(uow, clock, {
      input: { key: 'flag-2', name: 'Flag 2', description: '' },
      actor: 'actor-1',
    });

    await replaceRules(uow, clock, {
      ref: { flagKey: 'flag-2', environment: 'development' },
      rules: [],
      expectedVersion: 1,
      actor: 'actor-1',
    });

    const entry = db.current.auditLog.find((e) => e.action === 'rules.replaced');
    expect(entry?.environment).toBe('development');
  });
});
