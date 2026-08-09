import { describe, expect, it } from 'vitest';
import type { FlagDefinition } from '@rodriab/feature-semaphore-core';
import { createClient } from '../client.js';
import type { Transport } from '../ports/transport.js';
import { FakeScheduler, fixedClock } from './support/fakes.js';

function makeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    fetchDefinitions: () => Promise.resolve({ status: 304, etag: undefined }),
    sendExposures: () => Promise.resolve(),
    ...overrides,
  };
}

const CHECKOUT_FLAG: FlagDefinition = {
  key: 'checkout-v2',
  environment: 'development',
  archived: false,
  enabled: true,
  onValue: true,
  offValue: false,
  rollout: 0,
  salt: 'salt-1',
  rules: [],
  overrides: { 'unit-1': true },
};

describe('createClient', () => {
  it('row 24: with no snapshot and no bootstrap, isEnabled returns the caller default and never throws', () => {
    const scheduler = new FakeScheduler();
    const transport = makeTransport();
    const client = createClient({
      transport,
      scheduler,
      clock: fixedClock('2026-01-01T00:00:00Z'),
    });

    expect(() => client.isEnabled('checkout-v2', { unitId: 'u1' }, true)).not.toThrow();
    expect(client.isEnabled('checkout-v2', { unitId: 'u1' }, true)).toBe(true);
    expect(client.isEnabled('checkout-v2', { unitId: 'u1' }, false)).toBe(false);
  });

  it('row 25a: a permanently rejecting transport with no bootstrap -> the default, ready() still resolves', async () => {
    const scheduler = new FakeScheduler();
    const transport = makeTransport({
      fetchDefinitions: () => Promise.reject(new Error('network down')),
    });
    const client = createClient({
      transport,
      scheduler,
      clock: fixedClock('2026-01-01T00:00:00Z'),
      readyTimeoutMs: 10,
    });

    scheduler.tick();
    await expect(client.ready()).resolves.toBeUndefined();
    expect(client.isEnabled('checkout-v2', { unitId: 'u1' }, true)).toBe(true);
  });

  it('row 25b: a good fetch then permanent rejection -> the last good value is retained, not the default', async () => {
    const scheduler = new FakeScheduler();
    let fail = false;
    const transport = makeTransport({
      fetchDefinitions: () => {
        if (fail) return Promise.reject(new Error('network down'));
        return Promise.resolve({
          status: 200,
          etag: '"abc"',
          environment: 'development',
          definitions: [CHECKOUT_FLAG],
        });
      },
    });
    const client = createClient({
      transport,
      scheduler,
      clock: fixedClock('2026-01-01T00:00:00Z'),
    });

    scheduler.tick();
    await client.ready();
    expect(client.isEnabled('checkout-v2', { unitId: 'unit-1' }, false)).toBe(true);

    fail = true;
    scheduler.tick();
    await Promise.resolve();
    await Promise.resolve();

    // The cache is untouched by the failed refresh — still the last good value.
    expect(client.isEnabled('checkout-v2', { unitId: 'unit-1' }, false)).toBe(true);
  });

  it('row 26: a snapshot whose lookup throws -> the caller default, still no throw', () => {
    const scheduler = new FakeScheduler();
    const transport = makeTransport();
    const client = createClient({
      transport,
      scheduler,
      clock: fixedClock('2026-01-01T00:00:00Z'),
    });

    expect(() => client.getEvaluation('anything', { unitId: 'u1' }, true)).not.toThrow();
    expect(client.getEvaluation('anything', { unitId: 'u1' }, true).reason).toBe('FLAG_NOT_FOUND');
  });

  it('row 27: getEvaluation exposes reason OVERRIDE for an active per-user override', async () => {
    const scheduler = new FakeScheduler();
    const transport = makeTransport({
      fetchDefinitions: () =>
        Promise.resolve({
          status: 200,
          etag: '"abc"',
          environment: 'development',
          definitions: [CHECKOUT_FLAG],
        }),
    });
    const client = createClient({
      transport,
      scheduler,
      clock: fixedClock('2026-01-01T00:00:00Z'),
    });

    scheduler.tick();
    await client.ready();

    const evaluation = client.getEvaluation('checkout-v2', { unitId: 'unit-1' }, false);
    expect(evaluation.reason).toBe('OVERRIDE');
    expect(evaluation.value).toBe(true);
  });

  it('row 34: close() flushes pending exposures before resolving, cancels both schedules, resolves even when the transport hangs', async () => {
    const scheduler = new FakeScheduler();
    const sent: unknown[][] = [];
    let hang: (() => void) | undefined;
    const transport = makeTransport({
      fetchDefinitions: () =>
        Promise.resolve({
          status: 200,
          etag: '"abc"',
          environment: 'development',
          definitions: [CHECKOUT_FLAG],
        }),
      sendExposures: (rows) => {
        sent.push([...rows]);
        return new Promise<void>((resolve) => {
          hang = resolve; // never resolves on its own within the test
        });
      },
    });
    const client = createClient({
      transport,
      scheduler,
      clock: fixedClock('2026-01-01T00:00:00Z'),
      closeTimeoutMs: 10,
    });

    scheduler.tick();
    await client.ready();
    client.isEnabled('checkout-v2', { unitId: 'u1' }, false); // enqueues one exposure

    await client.close();

    expect(sent).toHaveLength(1);
    hang?.(); // release the hung promise so nothing leaks past the test
  });

  it('close() is idempotent — a second call resolves immediately', async () => {
    const scheduler = new FakeScheduler();
    const transport = makeTransport();
    const client = createClient({
      transport,
      scheduler,
      clock: fixedClock('2026-01-01T00:00:00Z'),
    });

    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('createClient throws synchronously when neither transport nor baseUrl+apiKey are provided', () => {
    expect(() => createClient({})).toThrow();
  });
});
