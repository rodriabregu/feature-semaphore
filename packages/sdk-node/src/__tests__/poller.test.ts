import { describe, expect, it } from 'vitest';
import type { FlagDefinition } from '@rodriab/feature-semaphore-core';
import { startPoller } from '../poller.js';
import { buildSnapshot, createSnapshotBox } from '../snapshot-store.js';
import type { Transport } from '../ports/transport.js';
import { FakeScheduler, fixedClock } from './support/fakes.js';

const FLAG: FlagDefinition = {
  key: 'checkout-v2',
  environment: 'development',
  archived: false,
  enabled: true,
  onValue: true,
  offValue: false,
  rollout: 0,
  salt: 'salt-1',
  rules: [],
  overrides: {},
};

describe('startPoller', () => {
  it('row 28: a 304 preserves the previous snapshot and its ETag', async () => {
    const scheduler = new FakeScheduler();
    const initial = buildSnapshot(
      [FLAG],
      '"etag-1"',
      'development',
      new Date('2026-01-01T00:00:00Z'),
    );
    const box = createSnapshotBox(initial);
    const transport: Pick<Transport, 'fetchDefinitions'> = {
      fetchDefinitions: () => Promise.resolve({ status: 304, etag: '"etag-1"' }),
    };

    startPoller({ transport, scheduler, clock: fixedClock('2026-01-01T00:01:00Z'), box });
    scheduler.tick();
    await Promise.resolve();
    await Promise.resolve();

    const after = box.get();
    expect(after?.etag).toBe('"etag-1"');
    expect(after?.byKey.get('checkout-v2')).toBe(FLAG);
  });

  it('row 28: a throw preserves both the snapshot and its ETag', async () => {
    const scheduler = new FakeScheduler();
    const initial = buildSnapshot(
      [FLAG],
      '"etag-1"',
      'development',
      new Date('2026-01-01T00:00:00Z'),
    );
    const box = createSnapshotBox(initial);
    const errors: unknown[] = [];
    const transport: Pick<Transport, 'fetchDefinitions'> = {
      fetchDefinitions: () => Promise.reject(new Error('network down')),
    };

    startPoller({
      transport,
      scheduler,
      clock: fixedClock('2026-01-01T00:01:00Z'),
      box,
      onError: (error) => errors.push(error),
    });
    scheduler.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toHaveLength(1);
    const after = box.get();
    expect(after?.etag).toBe('"etag-1"');
    expect(after).toBe(initial);
  });

  it('row 29: the bootstrap snapshot sends no If-None-Match on the first fetch', async () => {
    const scheduler = new FakeScheduler();
    // Mirrors createClient's bootstrap installation: etag is deliberately undefined.
    const bootstrapSnapshot = buildSnapshot(
      [FLAG],
      undefined,
      'development',
      new Date('2026-01-01T00:00:00Z'),
    );
    const box = createSnapshotBox(bootstrapSnapshot);
    const receivedEtags: (string | undefined)[] = [];
    const transport: Pick<Transport, 'fetchDefinitions'> = {
      fetchDefinitions: (etag) => {
        receivedEtags.push(etag);
        return Promise.resolve({ status: 304, etag: undefined });
      },
    };

    startPoller({ transport, scheduler, clock: fixedClock('2026-01-01T00:01:00Z'), box });
    scheduler.tick();
    await Promise.resolve();

    expect(receivedEtags).toEqual([undefined]);
  });

  it('one fetch in flight at a time — an overlapping tick is skipped', async () => {
    const scheduler = new FakeScheduler();
    const box = createSnapshotBox(undefined);
    let calls = 0;
    let resolveFetch: (() => void) | undefined;
    const transport: Pick<Transport, 'fetchDefinitions'> = {
      fetchDefinitions: () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveFetch = () => {
            resolve({ status: 304, etag: undefined });
          };
        });
      },
    };

    startPoller({ transport, scheduler, clock: fixedClock('2026-01-01T00:00:00Z'), box });
    scheduler.tick(); // starts a fetch, still pending
    scheduler.tick(); // should be skipped — a fetch is already in flight

    expect(calls).toBe(1);
    resolveFetch?.();
    await Promise.resolve();
    await Promise.resolve();
  });
});
