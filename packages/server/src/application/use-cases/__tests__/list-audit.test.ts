import { describe, expect, it } from 'vitest';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { createMemoryAuditLog } from '../../../infrastructure/persistence/memory/audit-log.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { createFlag } from '../create-flag.js';
import { listAudit } from '../list-audit.js';

describe('listAudit use case', () => {
  it('returns audit entries for the given flag key, bounded by limit', async () => {
    const db = new MemoryDatabase();
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const uow = createMemoryUnitOfWork(db, clock);
    await createFlag(uow, clock, {
      input: { key: 'flag-1', name: 'Flag 1', description: '' },
      actor: 'actor-1',
    });

    const audit = createMemoryAuditLog({ get: () => db.current });
    const entries = await listAudit(audit, 'flag-1', 10);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('flag.created');
  });
});
