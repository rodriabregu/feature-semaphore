import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  SESSION_EXPIRED_EVENT,
  sessionEvents,
  SessionExpiredError,
} from '../client.js';

interface FlagList {
  readonly flags: readonly unknown[];
}

describe('apiFetch — problem+json parsing (row 47)', () => {
  it('parses a 412 problem+json into an ApiProblem with expectedVersion/actualVersion intact', async () => {
    const problemBody = {
      type: 'https://feature-semaphore.dev/problems/version-conflict',
      title: 'Version conflict',
      status: 412,
      detail: 'the config changed since you read it',
      instance: '/api/flags/my-flag/config/development',
      expectedVersion: 7,
      actualVersion: 9,
    };
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(problemBody), {
          status: 412,
          headers: { 'content-type': 'application/problem+json' },
        }),
      ),
    );

    const caught = await apiFetch('/api/flags/my-flag/config/development', { fetchFn }).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiError);
    const error = caught as ApiError;
    expect(error.problem.status).toBe(412);
    expect(error.problem.expectedVersion).toBe(7);
    expect(error.problem.actualVersion).toBe(9);
  });

  it('yields a typed error for a non-problem 500, never undefined', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }),
      ),
    );

    const caught = await apiFetch<FlagList>('/api/flags', { fetchFn }).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).problem.status).toBe(500);
    expect((caught as ApiError).problem).not.toBeUndefined();
  });
});

describe('apiFetch — session expiry (row 48)', () => {
  it('dispatches the session-expired event exactly once for a 401 and throws a distinguishable error', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 401 })));
    const listener = vi.fn();
    sessionEvents.addEventListener(SESSION_EXPIRED_EVENT, listener);

    try {
      const caught = await apiFetch('/api/flags', { fetchFn }).catch((error: unknown) => error);

      expect(caught).toBeInstanceOf(SessionExpiredError);
      expect(caught).toBeInstanceOf(ApiError); // distinguishable, but still an ApiError
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      sessionEvents.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    }
  });

  it('suppresses the session-expired event when the caller opts out (e.g. POST /login)', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 401 })));
    const listener = vi.fn();
    sessionEvents.addEventListener(SESSION_EXPIRED_EVENT, listener);

    try {
      const caught = await apiFetch('/login', { fetchFn, suppressSessionExpiry: true }).catch(
        (error: unknown) => error,
      );

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught).not.toBeInstanceOf(SessionExpiredError);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      sessionEvents.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    }
  });
});
