import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminAuthHeader,
  buildTestApp,
  serverAuthHeader,
  SERVER_KEY,
  type TestApp,
} from '../../__tests__/test-app.js';

interface PerFlagResponseBody {
  readonly flag_key: string;
  readonly environment: string;
  readonly since: string;
  readonly total: number;
  readonly breakdown: readonly { value: boolean; reason: string; count: number }[];
}

interface BulkResponseBody {
  readonly environment: string;
  readonly since: string;
  readonly flags: readonly { flag_key: string; total: number }[];
}

/** test-app.ts's fake clock sits exactly on the hour, so truncation is a no-op here. */
const NOW = '2026-01-01T00:00:00.000Z';

async function createFlag(app: TestApp['app'], key: string): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/flags',
    headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
    payload: { key, name: key, description: '' },
  });
}

async function recordExposure(
  app: TestApp['app'],
  flagKey: string,
  value: boolean,
  reason: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/events',
      headers: {
        authorization: `Bearer ${SERVER_KEY}`,
        'content-type': 'application/json',
      },
      payload: { exposures: [{ flagKey, value, reason, count: 1 }] },
    });
  }
}

describe('GET /flags/:key/exposures', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildTestApp();
    await createFlag(testApp.app, 'checkout-v2');
  });

  it('missing env -> 400, never 403', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/flags/checkout-v2/exposures',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(400);
  });

  it('env: staging -> 400, never 403', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/flags/checkout-v2/exposures?env=staging',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(400);
  });

  it('body is {flag_key, environment, since, total, breakdown} — since is the effective window, no bucket_hour anywhere', async () => {
    await recordExposure(testApp.app, 'checkout-v2', true, 'FALLTHROUGH_ROLLOUT', 3);

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/flags/checkout-v2/exposures?env=development',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(200);
    const raw: string = response.body;
    expect(raw).not.toContain('bucket_hour');

    const body: PerFlagResponseBody = response.json();
    expect(Object.keys(body).sort()).toEqual(
      ['breakdown', 'environment', 'flag_key', 'since', 'total'].sort(),
    );
    expect(body.flag_key).toBe('checkout-v2');
    expect(body.environment).toBe('development');
    expect(body.total).toBe(3);
    expect(body.since).toBe(new Date(new Date(NOW).getTime() - 24 * 60 * 60 * 1000).toISOString());
  });

  it('a valid server-kind key -> 403', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/flags/checkout-v2/exposures?env=development',
      headers: serverAuthHeader(),
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /exposures', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildTestApp();
    await createFlag(testApp.app, 'flag-a');
    await createFlag(testApp.app, 'flag-b');
    await createFlag(testApp.app, 'flag-c');
  });

  it('returns all three flags totals in one response', async () => {
    await recordExposure(testApp.app, 'flag-a', true, 'FALLTHROUGH_ROLLOUT', 1);
    await recordExposure(testApp.app, 'flag-b', true, 'FALLTHROUGH_ROLLOUT', 2);
    await recordExposure(testApp.app, 'flag-c', true, 'FALLTHROUGH_ROLLOUT', 3);

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/exposures?env=development',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(200);
    const body: BulkResponseBody = response.json();
    const byKey = new Map(body.flags.map((f) => [f.flag_key, f.total]));
    expect(byKey.get('flag-a')).toBe(1);
    expect(byKey.get('flag-b')).toBe(2);
    expect(byKey.get('flag-c')).toBe(3);
  });

  it('a flag literally keyed "exposures" is reachable at /flags/exposures/exposures and does not shadow /exposures', async () => {
    await createFlag(testApp.app, 'exposures');
    await recordExposure(testApp.app, 'exposures', true, 'FALLTHROUGH_ROLLOUT', 1);

    const perFlag = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/flags/exposures/exposures?env=development',
      headers: adminAuthHeader(),
    });
    expect(perFlag.statusCode).toBe(200);
    const perFlagBody: PerFlagResponseBody = perFlag.json();
    expect(perFlagBody.flag_key).toBe('exposures');

    const bulk = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/exposures?env=development',
      headers: adminAuthHeader(),
    });
    expect(bulk.statusCode).toBe(200);
    const bulkBody: BulkResponseBody = bulk.json();
    expect(Array.isArray(bulkBody.flags)).toBe(true);
  });

  it('a valid server-kind key -> 403', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/exposures?env=development',
      headers: serverAuthHeader(),
    });

    expect(response.statusCode).toBe(403);
  });
});
