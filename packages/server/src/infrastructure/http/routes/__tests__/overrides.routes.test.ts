import { beforeEach, describe, expect, it } from 'vitest';
import { adminAuthHeader, buildTestApp, type TestApp } from '../../__tests__/test-app.js';

describe('PUT /flags/:key/config/:env/overrides', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildTestApp();
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/flags',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { key: 'flag-1', name: 'Flag 1', description: '' },
    });
  });

  it('missing If-Match -> 428', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/flags/flag-1/config/development/overrides',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { overrides: [] },
    });

    expect(response.statusCode).toBe(428);
  });

  it('a valid If-Match replaces overrides and returns the new ETag', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/flags/flag-1/config/development/overrides',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { overrides: [{ unit_id: 'user-1', serve: true }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"2"');
  });
});
