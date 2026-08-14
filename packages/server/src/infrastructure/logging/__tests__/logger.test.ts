import { describe, expect, it } from 'vitest';
import { buildApp } from '../../../main/composition-root.js';

/**
 * Drives the PRODUCTION `buildApp` (design Part 2 §4, hard requirement #2)
 * with a real `createServerLogger` config and a captured in-memory stream —
 * not a hand-rolled logger assembled just for this test.
 */
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

const ADMIN_KEY = `fs_admin_${'a'.repeat(43)}`;

describe('structured logging — redaction (S1)', () => {
  it('redacts Authorization/Cookie and never logs a POST /api/v1/evaluate/preview user attribute', async () => {
    const { logs, stream } = captureLogs();
    const { app, start } = await buildApp(
      { databaseDriver: 'memory', adminApiKey: ADMIN_KEY },
      undefined,
      { stream },
    );
    await start();

    await app.inject({
      method: 'POST',
      url: '/api/v1/evaluate/preview',
      headers: {
        authorization: `Bearer ${ADMIN_KEY}`,
        cookie: 'session=super-secret-session-token',
      },
      payload: {
        flag_key: 'demo',
        environment: 'development',
        context: {
          unit_id: 'user-1',
          attributes: { email: 'alice@example.com' },
          default_value: false,
        },
      },
    });

    const output = logs.join('');
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain(ADMIN_KEY);
    expect(output).not.toContain('super-secret-session-token');
    expect(output).not.toContain('alice@example.com');
  });
});

describe('composition root — request id adoption (S1, design D4)', () => {
  it('adopts an inbound x-request-id header as request.id, visible in the request-completed log', async () => {
    const { logs, stream } = captureLogs();
    const inboundId = 'bff-generated-request-id-123';
    const { app, start } = await buildApp(
      { databaseDriver: 'memory', adminApiKey: ADMIN_KEY },
      undefined,
      { stream },
    );
    await start();

    await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': inboundId } });

    expect(logs.join('')).toContain(inboundId);
  });

  it('generates its own id when no inbound x-request-id is present', async () => {
    const { logs, stream } = captureLogs();
    const { app, start } = await buildApp(
      { databaseDriver: 'memory', adminApiKey: ADMIN_KEY },
      undefined,
      { stream },
    );
    await start();

    await app.inject({ method: 'GET', url: '/healthz' });

    expect(logs.join('')).toMatch(/"reqId":"[^"]+"/);
  });
});
