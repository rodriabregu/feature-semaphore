import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../ports/clock.js';
import type { Delay } from '../../../ports/delay.js';
import { buildTestBff, TEST_ADMIN_API_KEY } from '../../__tests__/test-bff.js';
import type { ProxyRoute } from '../route-table.js';

const FAKE_CLOCK: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };
const FAKE_DELAY: Delay = { wait: () => Promise.resolve() };

/**
 * The exact three rows B3b adds to `PROXY_ROUTES` (task 6.4), declared here
 * so this RED test can be written before `route-table.ts` is modified — the
 * assertions exercise `forward()`'s fidelity, not the production table.
 */
const FLAGS_ROUTES: readonly ProxyRoute[] = [
  { method: 'GET', path: '/flags', mutating: false },
  { method: 'GET', path: '/flags/:key', mutating: false },
  { method: 'PATCH', path: '/flags/:key/config/:env', mutating: true },
];

describe('forward — absent routes 404 in both read-only modes, fetchFn never called (row 32)', () => {
  it.each([{ readOnly: false }, { readOnly: true }])(
    'POST /api/flags and POST /api/flags/:key/archive both 404 (readOnly=$readOnly)',
    async ({ readOnly }) => {
      const fetchFn = vi.fn();
      const { app, mintSessionCookie } = buildTestBff({
        fetchFn,
        clock: FAKE_CLOCK,
        delay: FAKE_DELAY,
        readOnly,
        routes: FLAGS_ROUTES,
      });
      const cookie = mintSessionCookie();

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/flags',
        headers: { cookie },
        payload: { key: 'demo', name: 'Demo' },
      });
      const archiveResponse = await app.inject({
        method: 'POST',
        url: '/api/flags/demo/archive',
        headers: { cookie },
      });

      expect(createResponse.statusCode).toBe(404);
      expect(archiveResponse.statusCode).toBe(404);
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
});

describe('forward — outbound header allow-list (row 33)', () => {
  it('forwards exactly authorization + if-match + content-type, dropping cookie/own authorization/x-forwarded-for/user-agent', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(new Response('{"version":2}', { status: 200 }));
    });
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn: fetchFn as unknown as typeof fetch,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: FLAGS_ROUTES,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: {
        cookie: mintSessionCookie(),
        'if-match': '"5"',
        'content-type': 'application/json',
        authorization: 'Bearer attacker-supplied',
        'x-forwarded-for': '203.0.113.1',
        'user-agent': 'evil-agent/1.0',
      },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedHeaders).toEqual({
      authorization: `Bearer ${TEST_ADMIN_API_KEY}`,
      'if-match': '"5"',
      'content-type': 'application/json',
    });
  });
});

describe('forward — response header allow-list (row 34)', () => {
  it('returns exactly etag + content-type from upstream, dropping x-secret', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('{"version":3}', {
        status: 200,
        headers: { etag: '"3"', 'content-type': 'application/json', 'x-secret': 'do-not-leak' },
      }),
    );
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: FLAGS_ROUTES,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: { cookie: mintSessionCookie(), 'if-match': '"2"' },
      payload: { enabled: true },
    });

    expect(response.headers.etag).toBe('"3"');
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['x-secret']).toBeUndefined();
  });
});

describe('forward — If-Match forwarded verbatim, quotes included (row 35)', () => {
  it('forwards If-Match: "7" byte-identically', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(new Response('{"version":8}', { status: 200 }));
    });
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn: fetchFn as unknown as typeof fetch,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: FLAGS_ROUTES,
    });

    await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: { cookie: mintSessionCookie(), 'if-match': '"7"' },
      payload: { enabled: true },
    });

    expect(capturedHeaders?.['if-match']).toBe('"7"');
  });
});

describe('forward — a missing If-Match is never synthesised (row 36)', () => {
  it('forwards no if-match header, and the upstream 428 reaches the browser unchanged', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const problemBody = JSON.stringify({
      type: 'https://feature-semaphore.dev/problems/missing-precondition',
      title: 'If-Match header is required on this route',
      status: 428,
      detail: 'If-Match header is required on this route',
      instance: '/api/v1/flags/demo/config/production',
    });
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(
        new Response(problemBody, {
          status: 428,
          headers: { 'content-type': 'application/problem+json' },
        }),
      );
    });
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn: fetchFn as unknown as typeof fetch,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: FLAGS_ROUTES,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: { cookie: mintSessionCookie() },
      payload: { enabled: true },
    });

    expect(capturedHeaders?.['if-match']).toBeUndefined();
    expect(response.statusCode).toBe(428);
    expect(JSON.parse(response.payload)).toEqual(JSON.parse(problemBody));
  });
});

describe('forward — a 412 conflict keeps expectedVersion/actualVersion intact (row 37)', () => {
  it('passes the 412 body through unchanged', async () => {
    const problemBody = JSON.stringify({
      type: 'https://feature-semaphore.dev/problems/version-conflict',
      title: 'Version conflict',
      status: 412,
      detail: 'Version conflict',
      instance: '/api/v1/flags/demo/config/production',
      expectedVersion: 7,
      actualVersion: 9,
    });
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(problemBody, {
        status: 412,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: FLAGS_ROUTES,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: { cookie: mintSessionCookie(), 'if-match': '"7"' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(412);
    const parsed = JSON.parse(response.payload) as {
      expectedVersion: number;
      actualVersion: number;
    };
    expect(parsed.expectedVersion).toBe(7);
    expect(parsed.actualVersion).toBe(9);
  });
});

describe('forward — a successful mutation ETag and body pass through unmodified (row 38)', () => {
  it('returns the same ETag header and the same body bytes', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('{"version":8}', { status: 200, headers: { etag: '"8"' } }));
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: FLAGS_ROUTES,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/flags/demo/config/production',
      headers: { cookie: mintSessionCookie(), 'if-match': '"7"' },
      payload: { enabled: true },
    });

    expect(response.headers.etag).toBe('"8"');
    expect(response.payload).toBe('{"version":8}');
  });
});

describe('forward — the raw suffix is never rebuilt from decoded params (row 39)', () => {
  it('forwards a %2F-bearing key with the identical percent-encoded bytes', async () => {
    let capturedUrl: string | undefined;
    const fetchFn = vi.fn((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response('{"key":"team/alpha"}', { status: 200 }));
    });
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn: fetchFn as unknown as typeof fetch,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: [{ method: 'GET', path: '/flags/:key', mutating: false }],
    });

    await app.inject({
      method: 'GET',
      url: '/api/flags/team%2Falpha',
      headers: { cookie: mintSessionCookie() },
    });

    expect(capturedUrl).toBe('http://upstream.test/api/v1/flags/team%2Falpha');
  });
});

describe('forward — an unreachable upstream surfaces as a BFF-namespaced 502 (row 40)', () => {
  it('returns 502 under the BFF type namespace and logs the failure', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('upstream network down'));
    const logs: string[] = [];
    const logStream = {
      write: (chunk: string): boolean => {
        logs.push(chunk);
        return true;
      },
    };
    const { app, mintSessionCookie } = buildTestBff({
      fetchFn,
      clock: FAKE_CLOCK,
      delay: FAKE_DELAY,
      readOnly: false,
      routes: [{ method: 'GET', path: '/flags', mutating: false }],
      logStream,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/flags',
      headers: { cookie: mintSessionCookie() },
    });

    expect(response.statusCode).toBe(502);
    const problem = JSON.parse(response.payload) as { type: string; status: number };
    expect(problem.type).toContain('feature-semaphore.dev/problems/bff');
    expect(problem.status).toBe(502);
    expect(logs.some((line) => line.includes('upstream network down'))).toBe(true);
  });
});
