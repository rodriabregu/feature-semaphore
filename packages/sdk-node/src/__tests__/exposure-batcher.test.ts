import { describe, expect, it } from 'vitest';
import { ExposureBatcher } from '../exposure-batcher.js';
import type { ExposureRecord } from '../ports/transport.js';
import { FakeScheduler } from './support/fakes.js';

describe('ExposureBatcher', () => {
  it('row 30: 10,000 record() calls over 3 flags produce <= 6 buffered rows', () => {
    const scheduler = new FakeScheduler();
    const batcher = new ExposureBatcher({
      transport: { sendExposures: () => Promise.resolve() },
      scheduler,
      highWaterMark: 1_000_000,
    });
    const flags = ['a', 'b', 'c'];

    for (let i = 0; i < 10_000; i += 1) {
      const flagKey = flags[i % 3] ?? 'a';
      const value = i % 2 === 0;
      batcher.record(flagKey, 'development', '2026-01-01T00:00:00.000Z', value, 'FLAG_OFF');
    }

    expect(batcher.size).toBeLessThanOrEqual(6);
  });

  it('row 31: at the distinct-key bound, an existing key still increments and a new key is dropped', async () => {
    const scheduler = new FakeScheduler();
    const sent: ExposureRecord[][] = [];
    const batcher = new ExposureBatcher({
      transport: {
        sendExposures: (rows) => {
          sent.push([...rows]);
          return Promise.resolve();
        },
      },
      scheduler,
      maxDistinctExposures: 2,
      highWaterMark: 1_000_000,
    });

    batcher.record('a', 'development', 'H', true, 'FLAG_OFF');
    batcher.record('b', 'development', 'H', true, 'FLAG_OFF');
    expect(batcher.size).toBe(2);

    expect(() => {
      batcher.record('a', 'development', 'H', true, 'FLAG_OFF'); // existing -> increments
      batcher.record('c', 'development', 'H', true, 'FLAG_OFF'); // new -> dropped
    }).not.toThrow();
    expect(batcher.size).toBe(2);

    await batcher.flush();

    expect(sent).toHaveLength(1);
    const rows = sent[0] ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.flagKey === 'a')?.count).toBe(2);
    expect(rows.some((r) => r.flagKey === 'c')).toBe(false);
  });

  it('row 32: a flush in flight suppresses a concurrent flush — the same row is never sent twice', async () => {
    const scheduler = new FakeScheduler();
    const sent: ExposureRecord[][] = [];
    let resolveSend: (() => void) | undefined;
    const batcher = new ExposureBatcher({
      transport: {
        sendExposures: (rows) => {
          sent.push([...rows]);
          return new Promise((resolve) => {
            resolveSend = resolve;
          });
        },
      },
      scheduler,
      highWaterMark: 1_000_000,
    });

    batcher.record('a', 'development', 'H', true, 'FLAG_OFF');

    const first = batcher.flush();
    const second = batcher.flush(); // no-op — a flush is already in flight

    resolveSend?.();
    await Promise.all([first, second]);

    expect(sent).toHaveLength(1);
  });

  it('row 33: a rejected flush drops the batch and is not retried on the following tick', async () => {
    const scheduler = new FakeScheduler();
    let calls = 0;
    const batcher = new ExposureBatcher({
      transport: {
        sendExposures: () => {
          calls += 1;
          return Promise.reject(new Error('network down'));
        },
      },
      scheduler,
      highWaterMark: 1_000_000,
    });

    batcher.record('a', 'development', 'H', true, 'FLAG_OFF');
    await batcher.flush();

    expect(calls).toBe(1);
    expect(batcher.size).toBe(0);

    scheduler.tick(); // the scheduled interval's own flush — buffer is empty, a no-op
    await Promise.resolve();

    expect(calls).toBe(1);
  });

  it('edge case 5.16: pre-snapshot (environment undefined) and post-snapshot exposures partition separately and both flush correctly', async () => {
    const scheduler = new FakeScheduler();
    const sent: ExposureRecord[][] = [];
    const batcher = new ExposureBatcher({
      transport: {
        sendExposures: (rows) => {
          sent.push([...rows]);
          return Promise.resolve();
        },
      },
      scheduler,
      highWaterMark: 1_000_000,
    });

    // Pre-snapshot: environment is undefined.
    batcher.record('checkout-v2', undefined, 'H', true, 'FLAG_OFF');
    batcher.record('checkout-v2', undefined, 'H', true, 'FLAG_OFF');
    // Post-snapshot: environment is now known.
    batcher.record('checkout-v2', 'development', 'H', true, 'FLAG_OFF');

    expect(batcher.size).toBe(2); // two distinct partitions, never merged

    await batcher.flush();

    expect(sent).toHaveLength(1);
    const rows = sent[0] ?? [];
    expect(rows).toHaveLength(2);
    const totalCount = rows.reduce((sum, r) => sum + r.count, 0);
    expect(totalCount).toBe(3); // no count lost across the undefined -> defined boundary
  });
});
