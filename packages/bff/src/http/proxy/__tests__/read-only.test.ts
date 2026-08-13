import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../ports/clock.js';
import type { Delay } from '../../../ports/delay.js';
import { buildTestBff } from '../../__tests__/test-bff.js';
import type { ProxyRoute } from '../route-table.js';

const FAKE_CLOCK: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };
const FAKE_DELAY: Delay = { wait: () => Promise.resolve() };

describe('read-only gate — fails closed (row 28)', () => {
  it('rejects a fixture row that never declared `mutating`, even under readOnly', async () => {
    const fetchFn = vi.fn();
    // Simulates a row that skipped the type system (e.g. via a cast from a
    // corrupt source) — never reachable through PROXY_ROUTES' `satisfies`,
    // but the runtime hook must refuse it anyway (design D3 §4).
    const malformedRoute = { method: 'GET', path: '/malformed' } as ProxyRoute;

    const { app } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: true,
      routes: [malformedRoute],
    });

    const response = await app.inject({ method: 'GET', url: '/malformed' });

    expect(response.statusCode).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('read-only gate — reads are unaffected (row 30)', () => {
  it('forwards a declared read to the fake upstream even under readOnly', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const readRoute: ProxyRoute = { method: 'GET', path: '/widgets', mutating: false };

    const { app } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: true,
      routes: [readRoute],
    });

    const response = await app.inject({ method: 'GET', url: '/widgets' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
  });
});
