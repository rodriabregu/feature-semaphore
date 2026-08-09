import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminAuthHeader,
  buildTestApp,
  productionServerAuthHeader,
  serverAuthHeader,
  type TestApp,
} from '../../__tests__/test-app.js';

/** Asserts a value the test itself just established, without a `!` assertion. */
function defined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

describe('sdk routes: GET /api/v1/sdk/definitions', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildTestApp();
  });

  it('a development key never sees a production-only flag; archived flags appear with archived: true', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'prod-only', name: 'prod-only', description: '' },
    });
    await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/prod-only/config/production',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { enabled: true },
    });
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'archived-flag', name: 'archived-flag', description: '' },
    });
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags/archived-flag/archive',
      headers: adminAuthHeader(),
    });

    const devResponse = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: serverAuthHeader(),
    });
    const prodResponse = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: productionServerAuthHeader(),
    });

    const devBody: {
      environment: string;
      definitions: { key: string; enabled: boolean; archived: boolean }[];
    } = devResponse.json();
    const prodBody: { environment: string; definitions: { key: string; enabled: boolean }[] } =
      prodResponse.json();

    expect(devBody.environment).toBe('development');
    expect(devBody.definitions.find((d) => d.key === 'prod-only')?.enabled).toBe(false);
    expect(prodBody.definitions.find((d) => d.key === 'prod-only')?.enabled).toBe(true);

    const archived = devBody.definitions.find((d) => d.key === 'archived-flag');
    expect(archived?.archived).toBe(true);
  });

  it('a second request echoing the returned ETag -> 304, empty body, ETag still present', async () => {
    const first = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: serverAuthHeader(),
    });
    const etag = defined(first.headers.etag);

    const second = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: { ...serverAuthHeader(), 'if-none-match': etag },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
    expect(second.headers.etag).toBe(etag);
  });

  it('after a config mutation, the same If-None-Match -> 200 with the new body and a different ETag', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'mutating-flag', name: 'mutating-flag', description: '' },
    });

    const first = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: serverAuthHeader(),
    });
    const etag = defined(first.headers.etag);

    await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/mutating-flag/config/development',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { enabled: true },
    });

    const second = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: { ...serverAuthHeader(), 'if-none-match': etag },
    });

    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).not.toBe(etag);
  });

  it('a development ETag replayed by a production key -> 200, not 304', async () => {
    const devFirst = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: serverAuthHeader(),
    });
    const devEtag = defined(devFirst.headers.etag);

    const prodReplay = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: { ...productionServerAuthHeader(), 'if-none-match': devEtag },
    });

    expect(prodReplay.statusCode).toBe(200);
  });

  it('the response carries Cache-Control: private, no-cache and Vary: Authorization', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: serverAuthHeader(),
    });

    expect(response.headers['cache-control']).toBe('private, no-cache');
    expect(response.headers.vary).toBe('Authorization');
  });

  it('the route declares no env path, query or body parameter', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions?environment=production',
      headers: serverAuthHeader(),
    });

    const body: { environment: string } = response.json();
    // The query string is simply ignored — environment always comes from the key.
    expect(body.environment).toBe('development');
  });
});
