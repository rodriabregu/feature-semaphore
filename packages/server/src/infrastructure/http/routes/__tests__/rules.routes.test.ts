import { beforeEach, describe, expect, it } from 'vitest';
import { adminAuthHeader, buildTestApp, type TestApp } from '../../__tests__/test-app.js';

describe('PUT /flags/:key/config/:env/rules', () => {
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

  it('honors If-Match identically to PATCH config: missing -> 428', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/flags/flag-1/config/development/rules',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { rules: [] },
    });

    expect(response.statusCode).toBe(428);
  });

  it('a valid If-Match replaces rules and returns the new ETag', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/flags/flag-1/config/development/rules',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: {
        rules: [
          { attribute: 'country', operator: 'in', values: ['US'], serve: true, rollout: 100 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"2"');
  });

  it('an unknown key inside a rule -> 400, never a silent 200 that strips it', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/flags/flag-1/config/development/rules',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: {
        rules: [
          {
            attribute: 'country',
            operator: 'in',
            values: ['US'],
            serve: true,
            rollout: 100,
            salt: 'x',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('a stale If-Match -> 412', async () => {
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/flags/flag-1/config/development/rules',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { rules: [] },
    });

    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/flags/flag-1/config/development/rules',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { rules: [] },
    });

    expect(response.statusCode).toBe(412);
  });
});
