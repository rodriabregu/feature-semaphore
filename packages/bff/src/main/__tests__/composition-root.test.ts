import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../composition-root.js';

const VALID_CONFIG = {
  upstreamUrl: 'http://localhost:3000',
  adminApiKey: `fs_admin_${'a'.repeat(43)}`,
  dashboardPassword: 'correct-horse-battery-staple',
  cookieSecure: true,
  readOnly: false,
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
});
