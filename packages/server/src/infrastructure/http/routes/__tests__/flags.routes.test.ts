import { beforeEach, describe, expect, it } from 'vitest';
import { adminAuthHeader, buildTestApp, type TestApp } from '../../__tests__/test-app.js';

describe('flags routes', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildTestApp();
  });

  it('POST /flags with an existing key -> 409, and no second row was written', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'flag-1', name: 'Flag 1', description: '' },
    });

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'flag-1', name: 'Flag 1 again', description: '' },
    });

    expect(response.statusCode).toBe(409);
    expect(testApp.db.current.flags.filter((f) => f.key === 'flag-1')).toHaveLength(1);
  });

  it('a body with an unknown key -> 400 (.strict())', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'flag-2', name: 'Flag 2', description: '', unknown_field: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it('a body containing salt -> 400 (.strict() on updateConfigBody)', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'flag-3', name: 'Flag 3', description: '' },
    });

    const response = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/flag-3/config/development',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { salt: 'new-salt' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('GET /flags returns both environments config for every flag, and emits no ETag', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'flag-4', name: 'Flag 4', description: '' },
    });

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/flags',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBeUndefined();
    const body: {
      flags: { key: string; environments: { development: unknown; production: unknown } }[];
    } = response.json();
    const flag = body.flags.find((f) => f.key === 'flag-4');
    expect(flag?.environments.development).toBeDefined();
    expect(flag?.environments.production).toBeDefined();
  });

  it('GET /flags/:key returns an archived flag marked archived: true, not filtered', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'flag-5', name: 'Flag 5', description: '' },
    });
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags/flag-5/archive',
      headers: adminAuthHeader(),
    });

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/flags/flag-5',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(200);
    const body: { archived: boolean } = response.json();
    expect(body.archived).toBe(true);
  });

  it('POST /flags/:key/archive returns 204', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'flag-6', name: 'Flag 6', description: '' },
    });

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags/flag-6/archive',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(204);
  });
});
