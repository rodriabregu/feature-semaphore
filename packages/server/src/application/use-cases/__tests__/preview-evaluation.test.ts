import { evaluate } from '@rodriab/feature-semaphore-core';
import { describe, expect, it } from 'vitest';
import { createMemoryFlagRepository } from '../../../infrastructure/persistence/memory/flag-repository.memory.js';
import { createMemoryUnitOfWork } from '../../../infrastructure/persistence/memory/unit-of-work.memory.js';
import { MemoryDatabase } from '../../../infrastructure/persistence/memory/store.js';
import { NotFoundError } from '../../errors/domain-error.js';
import { toFlagDefinition } from '../../mappers/flag-definition.mapper.js';
import { createFlag } from '../create-flag.js';
import { previewEvaluation, type CandidateOverlay } from '../preview-evaluation.js';

async function setup() {
  const db = new MemoryDatabase();
  const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  const uow = createMemoryUnitOfWork(db, clock);
  await createFlag(uow, clock, {
    input: { key: 'flag-1', name: 'Flag 1', description: '' },
    actor: 'actor-1',
  });
  const repo = createMemoryFlagRepository({ get: () => db.current }, clock);
  return { repo, db };
}

const CTX = { unitId: 'user-1', attributes: {}, defaultValue: false };

/** Asserts a value the test itself just established, without a `!` assertion. */
function defined<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  return value as T;
}

describe('previewEvaluation use case', () => {
  it('with no candidate, matches evaluate(toFlagDefinition(findByKey), ctx)', async () => {
    const { repo } = await setup();

    const result = await previewEvaluation(repo, {
      ref: { flagKey: 'flag-1', environment: 'development' },
      context: CTX,
    });

    const aggregate = await repo.findByKey({ flagKey: 'flag-1', environment: 'development' });
    const expected = evaluate(toFlagDefinition(defined(aggregate)), CTX);
    expect(result).toEqual(expected);
  });

  it('a candidate.rules overlay changes value/reason, and the saved aggregate is unmutated', async () => {
    const { repo } = await setup();

    const before = await repo.findByKey({ flagKey: 'flag-1', environment: 'development' });
    const snapshot = structuredClone(before);

    const candidate: CandidateOverlay = {
      enabled: true,
      rules: [{ attribute: 'plan', operator: 'in', values: ['pro'], serve: true, rollout: 100 }],
    };
    const result = await previewEvaluation(repo, {
      ref: { flagKey: 'flag-1', environment: 'development' },
      context: { unitId: 'user-1', attributes: { plan: 'pro' }, defaultValue: false },
      candidate,
    });

    expect(result.reason).toBe('RULE_MATCH:0');
    expect(result.value).toBe(true);

    const after = await repo.findByKey({ flagKey: 'flag-1', environment: 'development' });
    expect(after).toEqual(snapshot);
  });

  it('a candidate forged in TypeScript with salt/key/environment/archived leaves all four at their saved values', async () => {
    const { repo } = await setup();

    const forged = {
      salt: 'evil-salt',
      key: 'evil-key',
      environment: 'production',
      archived: true,
    } as unknown as CandidateOverlay;

    const result = await previewEvaluation(repo, {
      ref: { flagKey: 'flag-1', environment: 'development' },
      context: CTX,
      candidate: forged,
    });

    // The saved config is enabled, not archived, rollout 0 (default) — if
    // `archived: true` leaked through, the reason would be FLAG_ARCHIVED.
    expect(result.reason).not.toBe('FLAG_ARCHIVED');
  });

  it('an unknown flag_key throws NotFoundError, with and without a candidate', async () => {
    const { repo } = await setup();

    await expect(
      previewEvaluation(repo, {
        ref: { flagKey: 'no-such-flag', environment: 'development' },
        context: CTX,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      previewEvaluation(repo, {
        ref: { flagKey: 'no-such-flag', environment: 'development' },
        context: CTX,
        candidate: { enabled: true, rules: [], overrides: {} },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
