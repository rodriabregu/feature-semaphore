import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../composition-root.js';

const FIXTURE_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/dist');

const VALID_CONFIG = {
  upstreamUrl: 'http://localhost:3000',
  adminApiKey: `fs_admin_${'a'.repeat(43)}`,
  dashboardPassword: 'correct-horse-battery-staple',
  cookieSecure: true,
  readOnly: false,
  dashboardDistDir: FIXTURE_DIST_DIR,
};

describe('composition root', () => {
  it('/healthz is always 200, before and after start()', async () => {
    const { app } = await buildApp(VALID_CONFIG);

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
  });

  it('/readyz returns 503 before start() resolves and 200 after', async () => {
    const { app, start } = await buildApp(VALID_CONFIG);

    const before = await app.inject({ method: 'GET', url: '/readyz' });
    expect(before.statusCode).toBe(503);

    await start();

    const after = await app.inject({ method: 'GET', url: '/readyz' });
    expect(after.statusCode).toBe(200);
  });
});

/**
 * Drives the PRODUCTION `buildApp` directly — not `http/__tests__/test-bff.ts`.
 * That harness wires `registerProxyRoutes` + `sessionGuardPlugin` itself, so
 * every one of the 461 tests exercising the proxy proved the units correct
 * while asserting nothing about whether the real composition root assembles
 * them the same way. This is the one test that closes that gap (`#1921`).
 */
describe('composition root — proxy scope (B6)', () => {
  async function login(app: FastifyInstance): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { password: VALID_CONFIG.dashboardPassword },
    });
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookieHeader) throw new Error('login did not set a cookie');
    return cookieHeader.split(';')[0] ?? '';
  }

  it('rejects a proxied request with no session before any upstream call is made', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const { app } = await buildApp(VALID_CONFIG, fetchFn);

    const response = await app.inject({ method: 'GET', url: '/api/flags' });

    expect(response.statusCode).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('proxies an authenticated GET /api/flags to the stubbed upstream', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ flags: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { app } = await buildApp(VALID_CONFIG, fetchFn);
    const cookie = await login(app);

    const response = await app.inject({ method: 'GET', url: '/api/flags', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/flags',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('GET /api/metrics -> 404: no /metrics row exists in PROXY_ROUTES, so it is unreachable through the BFF (S2)', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const { app } = await buildApp(VALID_CONFIG, fetchFn);
    const cookie = await login(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a declared-mutating proxied route under READ_ONLY_MODE before any upstream call', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const { app } = await buildApp({ ...VALID_CONFIG, readOnly: true }, fetchFn);
    const cookie = await login(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/my-flag/config/development',
      headers: { cookie, 'if-match': '"1"', 'content-type': 'application/json' },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  /**
   * T3.2 / T3.3 (design `#1983` §9, §12) — the two RED tests deciding the
   * design's two INFERRED claims. Both authenticate first so session-guard's
   * own `onRequest` hook (identical shape to the read-only gate's hook) can
   * never be the reason a 404 is observed — isolating exactly the claim each
   * test is meant to decide.
   */
  it('T3.2: GET /api/nope -> 404, application/problem+json, never HTML', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const { app } = await buildApp(VALID_CONFIG, fetchFn);
    const cookie = await login(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/nope',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.payload.toLowerCase()).not.toContain('<html');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('T3.3: POST /api/nope under READ_ONLY_MODE -> 404, NOT 403 (design D3 interference risk)', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const { app } = await buildApp({ ...VALID_CONFIG, readOnly: true }, fetchFn);
    const cookie = await login(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/nope',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

/**
 * T3.1, T3.4, T3.5 (design `#1983` §9) — the rest of S3's assembly battery,
 * all driven through the production `buildApp`, never `test-bff.ts`.
 */
describe('composition root — dashboard static serving (S3)', () => {
  it('T3.1: GET /flags/checkout-v2 (client-side SPA route) -> 200 index.html', async () => {
    const { app } = await buildApp(VALID_CONFIG);

    const response = await app.inject({ method: 'GET', url: '/flags/checkout-v2' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('feature-semaphore dashboard');
  });

  it('T3.4: POST to an unknown non-API path -> 404, never the SPA shell', async () => {
    const { app } = await buildApp(VALID_CONFIG);

    const response = await app.inject({ method: 'POST', url: '/flags/checkout-v2' });

    expect(response.statusCode).toBe(404);
    expect(response.payload).not.toContain('feature-semaphore dashboard');
  });

  it('T3.5: GET /assets/<real file> -> 200 with the file bytes, not index.html', async () => {
    const { app } = await buildApp(VALID_CONFIG);

    const response = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain(
      "console.log('feature-semaphore dashboard test fixture asset')",
    );
  });

  /**
   * Design §10's path-traversal row. With `wildcard: false` no
   * request-derived path reaches the filesystem at all — this asserts the
   * observable behavior of that structural defence, not the mechanism
   * itself: neither form ever returns file contents outside `distDir`.
   */
  it.each(['/../../../etc/passwd', '/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd'])(
    'traversal attempt %s never returns file contents — 404 or the SPA shell only',
    async (path) => {
      const { app } = await buildApp(VALID_CONFIG);

      const response = await app.inject({ method: 'GET', url: path });

      expect(response.payload).not.toContain('root:');
      expect([200, 404]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        expect(response.payload).toContain('feature-semaphore dashboard');
      }
    },
  );

  it('HEAD /flags/checkout-v2 also gets the SPA shell (fallback applies to GET and HEAD only)', async () => {
    const { app } = await buildApp(VALID_CONFIG);

    const response = await app.inject({ method: 'HEAD', url: '/flags/checkout-v2' });

    expect(response.statusCode).toBe(200);
  });
});
