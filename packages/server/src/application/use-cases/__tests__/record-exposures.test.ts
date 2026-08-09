import { describe, expect, it } from 'vitest';
import type { ExposureAggregate, ExposureRepository } from '../../ports/exposure-repository.js';
import { recordExposures } from '../record-exposures.js';

/** Asserts a value the test itself just established, without a `!` assertion. */
function defined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

describe('recordExposures', () => {
  it('bucket_hour is the fake clock hour truncated to UTC; no client-supplied time reaches persistence', async () => {
    const recorded: ExposureAggregate[][] = [];
    const exposures: ExposureRepository = {
      recordBatch(rows) {
        recorded.push([...rows]);
        return Promise.resolve();
      },
    };
    const clock = { now: () => new Date('2026-03-15T14:47:33.123Z') };

    await recordExposures(exposures, clock, 'development', [
      { flagKey: 'checkout-v2', value: true, reason: 'FALLTHROUGH_ROLLOUT', count: 3 },
    ]);

    expect(recorded).toHaveLength(1);
    const batch = defined(recorded[0]);
    const row = defined(batch[0]);
    expect(row.bucketHour.toISOString()).toBe('2026-03-15T14:00:00.000Z');
  });

  it('a batch of inputs all share exactly one bucketHour, one call', async () => {
    const recorded: ExposureAggregate[][] = [];
    const exposures: ExposureRepository = {
      recordBatch(rows) {
        recorded.push([...rows]);
        return Promise.resolve();
      },
    };
    const clock = { now: () => new Date('2026-03-15T14:59:59.999Z') };

    await recordExposures(exposures, clock, 'production', [
      { flagKey: 'a', value: true, reason: 'FLAG_OFF', count: 1 },
      { flagKey: 'b', value: false, reason: 'OVERRIDE', count: 2 },
    ]);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toHaveLength(2);
    const bucketHours = new Set(recorded[0]?.map((r) => r.bucketHour.toISOString()));
    expect(bucketHours.size).toBe(1);
    expect([...bucketHours][0]).toBe('2026-03-15T14:00:00.000Z');
  });
});
