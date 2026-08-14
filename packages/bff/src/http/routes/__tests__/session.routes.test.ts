import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { describe, expect, it } from 'vitest';
import type { Clock } from '../../../ports/clock.js';
import type { Delay } from '../../../ports/delay.js';
import { createMemorySessionStore } from '../../../session/session-store.js';
import { createLoginThrottle } from '../../plugins/login-throttle.js';
import { BFF_PROBLEM_BY_CODE } from '../../problem.js';
import { registerSessionRoutes, SESSION_COOKIE_NAME } from '../session.routes.js';

const DASHBOARD_PASSWORD = 'correct-horse-battery-staple';
const ADMIN_API_KEY = `fs_admin_${'a'.repeat(43)}`;

function instantDelay(): Delay {
  return { wait: () => Promise.resolve() };
}

async function buildTestApp(options: { cookieSecure?: boolean } = {}) {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);

  const sessions = createMemorySessionStore();
  const clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  const throttle = createLoginThrottle(instantDelay());

  registerSessionRoutes(app, {
    config: {
      upstreamUrl: 'http://localhost:3000',
      adminApiKey: ADMIN_API_KEY,
      dashboardPassword: DASHBOARD_PASSWORD,
      cookieSecure: options.cookieSecure ?? true,
      readOnly: false,
      dashboardDistDir: '/tmp/does-not-need-to-exist-for-session-routes',
    },
    sessions,
    clock,
    throttle,
  });

  return { app, sessions, clock };
}

function setCookieHeader(response: { headers: Record<string, unknown> }): string | undefined {
  const raw = response.headers['set-cookie'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

describe('POST /login', () => {
  it('row 12: wrong password -> plain 401 invalid_credentials, no cookie, no session; no too_many_attempts / 429 exists', async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ type: string }>();
    expect(body.type).toContain('invalid-credentials');
    expect(response.payload).not.toContain(DASHBOARD_PASSWORD);
    expect(setCookieHeader(response)).toBeUndefined();
    expect(BFF_PROBLEM_BY_CODE).not.toHaveProperty('too_many_attempts');
    expect(Object.values(BFF_PROBLEM_BY_CODE).some((spec) => spec.status === 429)).toBe(false);
  });

  it('row 19/20: correct password -> 200 + Set-Cookie with HttpOnly, Secure, SameSite=Strict, Path=/', async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { password: DASHBOARD_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const cookieHeader = setCookieHeader(response);
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Secure');
    // Asserted BY NAME — this is the CSRF defence, not incidental.
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(cookieHeader).toContain('Path=/');
  });

  it('row 21: a 2 KiB login body returns 413, never reaching the comparison', async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { password: 'x'.repeat(2048) },
    });

    expect(response.statusCode).toBe(413);
  });

  it('row 25: after a successful login, neither body, header, nor cookie value contains ADMIN_API_KEY or any prefix', async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { password: DASHBOARD_PASSWORD },
    });

    const haystack = `${JSON.stringify(response.headers)}${response.payload}`;
    expect(haystack).not.toContain(ADMIN_API_KEY);
    expect(haystack).not.toContain('fs_admin_');
  });
});

describe('POST /logout', () => {
  it('revokes the session server-side and clears the cookie', async () => {
    const { app, sessions, clock } = await buildTestApp();
    const record = sessions.create(clock.now());

    const response = await app.inject({
      method: 'POST',
      url: '/logout',
      cookies: { [SESSION_COOKIE_NAME]: record.id },
    });

    expect(response.statusCode).toBe(204);
    expect(sessions.find(record.id, clock.now())).toBeUndefined();
  });
});
