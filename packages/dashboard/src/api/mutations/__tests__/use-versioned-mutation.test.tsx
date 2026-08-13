import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ApiError } from '../../client.js';
import { queryKeys } from '../../query-keys.js';
import type { ConfigRef, VersionedMutationSpec } from '../use-versioned-mutation.js';
import { useVersionedMutation } from '../use-versioned-mutation.js';
import type { FlagWire } from '../../types.js';

const SPEC: VersionedMutationSpec = {
  method: 'PATCH',
  path: (ref: ConfigRef) => `/api/flags/${ref.flagKey}/config/${ref.environment}`,
};

function makeFlag(developmentVersion: number, productionVersion = 1): FlagWire {
  const env = (version: number) => ({
    enabled: true,
    off_value: false,
    on_value: true,
    rollout_percentage: 10,
    salt: 'salt',
    updated_at: '2026-01-01T00:00:00.000Z',
    version,
    rules: [],
    overrides: {},
  });
  return {
    key: 'flag-1',
    name: 'Flag 1',
    description: '',
    archived: false,
    environments: { development: env(developmentVersion), production: env(productionVersion) },
  };
}

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

interface HarnessProps {
  readonly ref: ConfigRef;
}

function Harness({ ref }: HarnessProps): ReactElement {
  const mutation = useVersionedMutation<{ rollout_percentage: number }>(ref, SPEC);

  return (
    <div>
      <button
        onClick={() => {
          mutation.mutate({ rollout_percentage: 50 });
        }}
      >
        Save
      </button>
      {mutation.isError ? (
        <p role="alert">
          {mutation.error instanceof ApiError
            ? `conflict: expected v${String(mutation.error.problem.expectedVersion)}, actual v${String(mutation.error.problem.actualVersion)}`
            : mutation.error.message}
        </p>
      ) : null}
    </div>
  );
}

describe('useVersionedMutation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the version from the query cache at mutation time, not render time (row 52)', async () => {
    const queryClient = new QueryClient();
    const ref: ConfigRef = { flagKey: 'flag-1', environment: 'development' };
    queryClient.setQueryData(queryKeys.flag(ref.flagKey), makeFlag(3));

    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ version: 10 })));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <Harness ref={ref} />
      </QueryClientProvider>,
    );

    // Mutate the cache AFTER render — a version captured at render time would
    // still be 3; only a cache read inside mutationFn itself sees 9.
    queryClient.setQueryData(queryKeys.flag(ref.flagKey), makeFlag(9));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['if-match']).toBe('9');
  });

  it('a 412 issues exactly one request, invalidates the cache, and exposes actualVersion (row 53)', async () => {
    const queryClient = new QueryClient();
    const ref: ConfigRef = { flagKey: 'flag-1', environment: 'development' };
    queryClient.setQueryData(queryKeys.flag(ref.flagKey), makeFlag(3));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const problemBody = {
      type: 'https://feature-semaphore.dev/problems/version-conflict',
      title: 'Version conflict',
      status: 412,
      detail: 'the config changed since you read it',
      expectedVersion: 3,
      actualVersion: 5,
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(problemBody, 412, 'application/problem+json')),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <Harness ref={ref} />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.flag(ref.flagKey) });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('actual v5');

    // Never a second request — no retry, no silent overwrite attempt.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an empty query cache throws StaleCacheError and makes no request (row 54)', async () => {
    const queryClient = new QueryClient();
    const ref: ConfigRef = { flagKey: 'missing-flag', environment: 'development' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <Harness ref={ref} />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no cached version/i));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a successful mutation invalidates the cache rather than writing the response with setQueryData (row 55)', async () => {
    const queryClient = new QueryClient();
    const ref: ConfigRef = { flagKey: 'flag-1', environment: 'development' };
    queryClient.setQueryData(queryKeys.flag(ref.flagKey), makeFlag(3));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ version: 4 }))),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <Harness ref={ref} />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.flag(ref.flagKey) });
    });
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });
});
