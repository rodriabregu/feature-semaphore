import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createBffLogger } from '../logger.js';
import { buildApp } from '../composition-root.js';

const FIXTURE_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/dist');

const ADMIN_KEY = `fs_admin_${'a'.repeat(43)}`;
const DASHBOARD_PASSWORD = 'correct-horse-battery-staple';

const VALID_CONFIG = {
  upstreamUrl: 'http://localhost:3000',
  adminApiKey: ADMIN_KEY,
  dashboardPassword: DASHBOARD_PASSWORD,
  cookieSecure: true,
  readOnly: false,
  dashboardDistDir: FIXTURE_DIST_DIR,
};

function captureLogs(): { logs: string[]; stream: { write(chunk: string): boolean } } {
  const logs: string[] = [];
  return {
    logs,
    stream: {
      write: (chunk: string) => {
        logs.push(chunk);
        return true;
      },
    },
  };
}

describe('createBffLogger — level configurable via LOG_LEVEL (correction, #1988 review)', () => {
  const original = process.env.LOG_LEVEL;

  afterEach(() => {
    if (original === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = original;
  });

  it('defaults to info when LOG_LEVEL is unset', () => {
    delete process.env.LOG_LEVEL;
    expect(createBffLogger().level).toBe('info');
  });

  it('honours LOG_LEVEL when set — the vitest config sets it to silent', () => {
    process.env.LOG_LEVEL = 'warn';
    expect(createBffLogger().level).toBe('warn');
  });
});

/**
 * The BFF's own redaction, asserted through the PRODUCTION `buildApp` and a
 * real pino instance writing to a captured stream — not by reading the
 * config back, which would only prove redaction was requested.
 *
 * The server copy of this test exists at
 * `packages/server/src/infrastructure/logging/__tests__/logger.test.ts`.
 * Both are needed: the two logger factories are deliberately duplicated
 * (design Part 2 §8), so a redact list correct in one proves nothing about
 * the other — and this is the process that holds the full-write admin key
 * and faces the public internet.
 *
 * Each case pairs its `not.toContain` assertions with a positive one. On an
 * empty stream every negative assertion passes vacuously, so without the
 * positive the test could not tell "redacted" from "nothing was logged"
 * (see the negative-assertion rule recorded during S1's correction).
 */
describe('createBffLogger — redaction through the production entry point', () => {
  it('redacts the Authorization and Cookie request headers', async () => {
    const { logs, stream } = captureLogs();
    const { app } = await buildApp(VALID_CONFIG, fetch, { stream, level: 'info' });

    await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: {
        authorization: `Bearer ${ADMIN_KEY}`,
        cookie: 'fs_session=super-secret-session-token',
      },
    });

    const output = logs.join('');
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain(ADMIN_KEY);
    expect(output).not.toContain('super-secret-session-token');
  });

  /**
   * The BFF-specific risk the server does not have: `POST /login` mints the
   * session cookie in a `set-cookie` RESPONSE header. A token logged on the
   * way out is exactly as usable to an attacker as one logged on the way in.
   */
  it('redacts the set-cookie response header when login mints a session', async () => {
    const { logs, stream } = captureLogs();
    const { app } = await buildApp(VALID_CONFIG, fetch, { stream, level: 'info' });

    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { password: DASHBOARD_PASSWORD },
    });

    // Positive control: login really did mint a cookie, so the assertion
    // below is about redaction rather than about an absent header.
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();

    const output = logs.join('');
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain(DASHBOARD_PASSWORD);
    expect(output).not.toContain(String(setCookie));
  });
});
