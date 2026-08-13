import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../ports/clock.js';
import { createMemorySessionStore } from '../../../session/session-store.js';
import { createLoginThrottle } from '../login-throttle.js';
import { registerSessionRoutes } from '../../routes/session.routes.js';
import { sessionGuardPlugin, SESSION_COOKIE_NAME } from '../session-guard.js';

const DASHBOARD_PASSWORD = 'correct-horse-battery-staple';

function setCookieHeader(response: { headers: Record<string, unknown> }): string | undefined {
  const raw = response.headers['set-cookie'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

describe('sessionGuardPlugin', () => {
  it('row 23: no cookie / unknown id / expired id -> 401 unauthenticated, fake fetchFn never called', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    let currentTime = new Date('2026-01-01T00:00:00.000Z');
    const clock: Clock = { now: () => currentTime };
    const sessions = createMemorySessionStore(1); // 1ms TTL — trivial to expire deterministically

    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await app.register((scoped, _opts, done) => {
      sessionGuardPlugin(scoped, { sessions, clock });
      scoped.get('/protected', async (_request, reply) => {
        await fetchFn();
        reply.send({ ok: true });
      });
      done();
    });

    const noCookie = await app.inject({ method: 'GET', url: '/protected' });
    expect(noCookie.statusCode).toBe(401);
    const noCookieBody = noCookie.json<{ type: string }>();
    expect(noCookieBody.type).toContain('unauthenticated');

    const unknownId = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { [SESSION_COOKIE_NAME]: 'this-session-does-not-exist' },
    });
    expect(unknownId.statusCode).toBe(401);

    const record = sessions.create(currentTime);
    currentTime = new Date(record.expiresAt.getTime()); // exactly expired
    const expiredId = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { [SESSION_COOKIE_NAME]: record.id },
    });
    expect(expiredId.statusCode).toBe(401);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('row 24: an active session, then POST /logout, then the same cookie on a guarded route -> 401, no upstream call', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const clock: Clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
    const sessions = createMemorySessionStore();
    const throttle = createLoginThrottle({ wait: () => Promise.resolve() });

    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(fastifyCookie);
    registerSessionRoutes(app, {
      config: {
        upstreamUrl: 'http://localhost:3000',
        adminApiKey: `fs_admin_${'a'.repeat(43)}`,
        dashboardPassword: DASHBOARD_PASSWORD,
        cookieSecure: true,
      },
      sessions,
      clock,
      throttle,
    });
    await app.register((scoped, _opts, done) => {
      sessionGuardPlugin(scoped, { sessions, clock });
      scoped.get('/protected', async (_request, reply) => {
        await fetchFn();
        reply.send({ ok: true });
      });
      done();
    });

    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { password: DASHBOARD_PASSWORD },
    });
    const cookieHeader = setCookieHeader(login);
    const sessionId = /fs_dash_sid=([^;]+)/.exec(cookieHeader ?? '')?.[1];
    if (!sessionId) throw new Error('expected /login to set a session cookie');

    const beforeLogout = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { [SESSION_COOKIE_NAME]: sessionId },
    });
    expect(beforeLogout.statusCode).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const logout = await app.inject({
      method: 'POST',
      url: '/logout',
      cookies: { [SESSION_COOKIE_NAME]: sessionId },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { [SESSION_COOKIE_NAME]: sessionId },
    });
    expect(afterLogout.statusCode).toBe(401);
    // Still 1 — the guarded route was never reached the second time.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
