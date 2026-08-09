import { describe, expect, it } from 'vitest';
import type {
  ExposureBreakdown,
  ExposureBreakdownQuery,
  ExposureFlagTotal,
  ExposureRepository,
  ExposureWindowQuery,
} from '../../ports/exposure-repository.js';
import { listExposures, listFlagTotals } from '../list-exposures.js';

function fakeExposures(overrides: {
  breakdown?: readonly ExposureBreakdown[];
  totals?: readonly ExposureFlagTotal[];
}): {
  repo: ExposureRepository;
  breakdownCalls: ExposureBreakdownQuery[];
  totalsCalls: ExposureWindowQuery[];
} {
  const breakdownCalls: ExposureBreakdownQuery[] = [];
  const totalsCalls: ExposureWindowQuery[] = [];
  const repo: ExposureRepository = {
    recordBatch: () => Promise.reject(new Error('not used by this test')),
    findBreakdown(query) {
      breakdownCalls.push(query);
      return Promise.resolve(overrides.breakdown ?? []);
    },
    listFlagTotals(query) {
      totalsCalls.push(query);
      return Promise.resolve(overrides.totals ?? []);
    },
  };
  return { repo, breakdownCalls, totalsCalls };
}

describe('listExposures use case (per-flag)', () => {
  it('total equals the sum of breakdown[].count, from exactly one repository call', async () => {
    const { repo, breakdownCalls } = fakeExposures({
      breakdown: [
        { value: true, reason: 'FALLTHROUGH_ROLLOUT', count: 9001 },
        { value: false, reason: 'FLAG_OFF', count: 42 },
      ],
    });

    const result = await listExposures(repo, {
      flagKey: 'checkout-v2',
      environment: 'development',
      since: new Date('2026-01-01T10:30:00Z'),
    });

    expect(result.total).toBe(9043);
    expect(breakdownCalls).toHaveLength(1);
  });

  it('the since handed to the repository is truncated to the UTC hour; breakdown comes back deterministically sorted', async () => {
    const { repo, breakdownCalls } = fakeExposures({
      breakdown: [
        { value: false, reason: 'FLAG_OFF', count: 1 },
        { value: true, reason: 'FALLTHROUGH_ROLLOUT', count: 100 },
        { value: true, reason: 'OVERRIDE', count: 100 },
      ],
    });

    const result = await listExposures(repo, {
      flagKey: 'checkout-v2',
      environment: 'development',
      since: new Date('2026-01-01T10:30:45.123Z'),
    });

    expect(breakdownCalls[0]?.since.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(result.since.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    // count DESC, then reason in code-unit order (never localeCompare)
    expect(result.breakdown.map((b) => b.reason)).toEqual([
      'FALLTHROUGH_ROLLOUT',
      'OVERRIDE',
      'FLAG_OFF',
    ]);
  });
});

describe('listFlagTotals use case (bulk)', () => {
  it('truncates since to the UTC hour and sorts flags by flag_key in code-unit order', async () => {
    const { repo, totalsCalls } = fakeExposures({
      totals: [
        { flagKey: 'zeta', total: 1 },
        { flagKey: 'alpha', total: 2 },
      ],
    });

    const result = await listFlagTotals(repo, {
      environment: 'development',
      since: new Date('2026-01-01T10:30:00Z'),
    });

    expect(totalsCalls[0]?.since.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(result.flags.map((f) => f.flagKey)).toEqual(['alpha', 'zeta']);
  });
});
