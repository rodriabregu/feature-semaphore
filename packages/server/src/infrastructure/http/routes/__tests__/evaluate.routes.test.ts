import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminAuthHeader,
  buildTestApp,
  serverAuthHeader,
  type TestApp,
} from '../../__tests__/test-app.js';

interface PreviewResponseBody {
  readonly value: boolean;
  readonly reason: string;
  readonly flag_key: string;
  readonly environment: string;
  readonly candidate_applied: boolean;
}

describe('POST /evaluate/preview', () => {
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

  it('200 body is exactly {value, reason, flag_key, environment, candidate_applied}; false without a candidate', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate/preview',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: {
        flag_key: 'flag-1',
        environment: 'development',
        context: { unit_id: 'user-1', attributes: {}, default_value: false },
      },
    });

    expect(response.statusCode).toBe(200);
    const body: PreviewResponseBody = response.json();
    expect(Object.keys(body).sort()).toEqual(
      ['candidate_applied', 'environment', 'flag_key', 'reason', 'value'].sort(),
    );
    expect(body.flag_key).toBe('flag-1');
    expect(body.environment).toBe('development');
    expect(body.candidate_applied).toBe(false);
  });

  it('candidate_applied is true with a candidate, including an empty {} candidate', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate/preview',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: {
        flag_key: 'flag-1',
        environment: 'development',
        context: { unit_id: 'user-1', attributes: {}, default_value: false },
        candidate: {},
      },
    });

    expect(response.statusCode).toBe(200);
    const body: PreviewResponseBody = response.json();
    expect(body.candidate_applied).toBe(true);
  });

  it('a candidate.rules overlay changes the evaluation, wire-mapping on_value/overrides to domain shape', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate/preview',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: {
        flag_key: 'flag-1',
        environment: 'development',
        context: { unit_id: 'user-1', attributes: { plan: 'pro' }, default_value: false },
        candidate: {
          enabled: true,
          on_value: true,
          rules: [
            { operator: 'in', attribute: 'plan', values: ['pro'], serve: true, rollout: 100 },
          ],
          overrides: [{ unit_id: 'someone-else', serve: false }],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body: PreviewResponseBody = response.json();
    expect(body.reason).toBe('RULE_MATCH:0');
    expect(body.value).toBe(true);
  });

  it('unknown flag -> 404 not_found, application/problem+json', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate/preview',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: {
        flag_key: 'no-such-flag',
        environment: 'development',
        context: { unit_id: 'user-1', attributes: {}, default_value: false },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const body: { type: string } = response.json();
    expect(body.type).toContain('not-found');
  });

  it('a valid server-kind key -> 403', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate/preview',
      headers: { ...serverAuthHeader(), 'content-type': 'application/json' },
      payload: {
        flag_key: 'flag-1',
        environment: 'development',
        context: { unit_id: 'user-1', attributes: {}, default_value: false },
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('writes no audit row, with or without a candidate', async () => {
    const before = testApp.db.current.auditLog.length;

    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate/preview',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: {
        flag_key: 'flag-1',
        environment: 'development',
        context: { unit_id: 'user-1', attributes: {}, default_value: false },
      },
    });
    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate/preview',
      headers: { ...adminAuthHeader(), 'content-type': 'application/json' },
      payload: {
        flag_key: 'flag-1',
        environment: 'development',
        context: { unit_id: 'user-1', attributes: {}, default_value: false },
        candidate: { enabled: true },
      },
    });

    expect(testApp.db.current.auditLog.length).toBe(before);
  });
});
