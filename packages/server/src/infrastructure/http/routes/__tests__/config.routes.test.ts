import { beforeEach, describe, expect, it } from 'vitest';
import { adminAuthHeader, buildTestApp, type TestApp } from '../../__tests__/test-app.js';

async function createFlag(app: TestApp['app']): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/flags',
    headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
    payload: { key: 'flag-1', name: 'Flag 1', description: '' },
  });
}

describe('PATCH /flags/:key/config/:env', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildTestApp();
    await createFlag(testApp.app);
  });

  it('no If-Match -> 428', async () => {
    const response = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/flag-1/config/development',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(428);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('If-Match: "abc" -> 400, never 412', async () => {
    const response = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/flag-1/config/development',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '"abc"' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it('a valid If-Match succeeds and returns the ETag with the new version', async () => {
    const response = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/flag-1/config/development',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"2"');
  });

  it('a second PATCH reusing the first If-Match -> 412 with expected/actual', async () => {
    await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/flag-1/config/development',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { enabled: true },
    });

    const response = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/flag-1/config/development',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(412);
    const body: { expectedVersion: number; actualVersion: number } = response.json();
    expect(body.expectedVersion).toBe(1);
    expect(body.actualVersion).toBe(2);
  });

  it('an unknown environment path value -> 400, not 403', async () => {
    const response = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/flags/flag-1/config/staging',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json', 'if-match': '1' },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(400);
  });
});
