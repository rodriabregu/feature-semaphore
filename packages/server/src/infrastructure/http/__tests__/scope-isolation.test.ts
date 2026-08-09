import { describe, expect, it } from 'vitest';
import { adminAuthHeader, buildTestApp, serverAuthHeader } from './test-app.js';

/**
 * The regression guard for the whole SDK-auth boundary: fails the moment the
 * SDK scope is ever registered NESTED inside `/api/v1` instead of as a
 * SIBLING `register` call, because a nested scope would run the management
 * `onRequest` hook first and 403 every server key before the SDK's own hook
 * ever runs.
 */
describe('scope isolation between /api/v1 and /api/v1/sdk', () => {
  it('a server key succeeds on the SDK scope and is forbidden on the management scope', async () => {
    const { app } = await buildTestApp();

    const sdkResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: serverAuthHeader(),
    });
    expect(sdkResponse.statusCode).toBe(200);

    const managementResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/flags',
      headers: serverAuthHeader(),
    });
    expect(managementResponse.statusCode).toBe(403);
  });

  it('an admin key is forbidden on the SDK scope and succeeds on the management scope', async () => {
    const { app } = await buildTestApp();

    const sdkResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: adminAuthHeader(),
    });
    expect(sdkResponse.statusCode).toBe(403);

    const managementResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/flags',
      headers: adminAuthHeader(),
    });
    expect(managementResponse.statusCode).toBe(200);
  });
});
