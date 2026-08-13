import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../ports/clock.js';
import type { Delay } from '../../../ports/delay.js';
import { buildTestBff } from '../../__tests__/test-bff.js';
import { PROXY_ROUTES, type ProxyRoute } from '../route-table.js';

const FAKE_CLOCK: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };
const FAKE_DELAY: Delay = { wait: () => Promise.resolve() };

describe('read-only gate — fails closed (row 28)', () => {
  it('rejects a fixture row that never declared `mutating`, even under readOnly', async () => {
    const fetchFn = vi.fn();
    // Simulates a row that skipped the type system (e.g. via a cast from a
    // corrupt source) — never reachable through PROXY_ROUTES' `satisfies`,
    // but the runtime hook must refuse it anyway (design D3 §4).
    const malformedRoute = { method: 'GET', path: '/malformed' } as ProxyRoute;

    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: true,
      routes: [malformedRoute],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/malformed',
      headers: { cookie: mintSessionCookie() },
    });

    expect(response.statusCode).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('read-only gate — reads are unaffected (row 30)', () => {
  it('forwards a declared read to the fake upstream even under readOnly', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const readRoute: ProxyRoute = { method: 'GET', path: '/widgets', mutating: false };

    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: true,
      routes: [readRoute],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/widgets',
      headers: { cookie: mintSessionCookie() },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
  });
});

describe('read-only gate — blocks a route declared mutating on a real route (row 41)', () => {
  it('rejects a PATCH to the real config route with 403, upstream never called', async () => {
    const fetchFn = vi.fn();
    const configRoute: ProxyRoute = {
      method: 'PATCH',
      path: '/flags/:key/config/:env',
      mutating: true,
    };

    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: true,
      routes: [configRoute],
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: { cookie: mintSessionCookie(), 'if-match': '"1"' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('read-only gate — default mode allows a mutation with a fresh session (row 42)', () => {
  it('forwards a valid PATCH to the real config route when READ_ONLY_MODE is unset', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"version":2}', { status: 200 }));
    const configRoute: ProxyRoute = {
      method: 'PATCH',
      path: '/flags/:key/config/:env',
      mutating: true,
    };

    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: [configRoute],
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: { cookie: mintSessionCookie(), 'if-match': '"1"' },
      payload: { enabled: true },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
  });
});

/**
 * The load-bearing test of the whole gateway (design `#1905`, spec `#1894`
 * X2): `mutating` is declared per route, never derived from the HTTP
 * method. `POST /evaluate/preview` is a POST that writes nothing — verified
 * at `packages/server/src/infrastructure/http/routes/evaluate.routes.ts:14-19`
 * ("No `uow`, no `audit`, no `clock` — a pure read") — so a method-derived
 * rule would incorrectly 403 it under `READ_ONLY_MODE`, breaking the exact
 * screen that best demonstrates a read-only deployment. Audit and exposures
 * reads forward for the same reason every other declared-read does.
 */
describe('read-only gate — POST /evaluate/preview forwards under READ_ONLY_MODE despite its method (row 44)', () => {
  it('forwards preview, audit, and exposures reads while READ_ONLY_MODE=true', async () => {
    // A fresh `Response` per call — `arrayBuffer()` can only drain a body
    // once, and this test makes 4 real requests through the same `fetchFn`.
    const fetchFn = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response('{"value":true,"reason":"FALLTHROUGH_ROLLOUT"}', { status: 200 }),
        ),
      );
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: true,
      routes: PROXY_ROUTES,
    });
    const cookie = mintSessionCookie();

    const previewResponse = await app.inject({
      method: 'POST',
      url: '/api/evaluate/preview',
      headers: { cookie },
      payload: {
        flag_key: 'demo',
        environment: 'production',
        context: { unit_id: 'user-1', default_value: false },
      },
    });
    const auditResponse = await app.inject({
      method: 'GET',
      url: '/api/flags/demo/audit',
      headers: { cookie },
    });
    const perFlagExposuresResponse = await app.inject({
      method: 'GET',
      url: '/api/flags/demo/exposures',
      headers: { cookie },
    });
    const bulkExposuresResponse = await app.inject({
      method: 'GET',
      url: '/api/exposures',
      headers: { cookie },
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(auditResponse.statusCode).toBe(200);
    expect(perFlagExposuresResponse.statusCode).toBe(200);
    expect(bulkExposuresResponse.statusCode).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('still refuses a declared-mutating route under the same READ_ONLY_MODE, proving the mode is genuinely active', async () => {
    const fetchFn = vi.fn();
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: true,
      routes: PROXY_ROUTES,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: { cookie: mintSessionCookie(), 'if-match': '"1"' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
