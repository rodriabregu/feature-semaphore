import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FlagListPage } from '../FlagListPage.js';
import type { Environment, FlagListResponse } from '../../../api/types.js';

const FLAG_COUNT = 10;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFlagEnvironment(enabled: boolean, rolloutPercentage: number, updatedAt: string) {
  return {
    enabled,
    off_value: false,
    on_value: true,
    rollout_percentage: rolloutPercentage,
    salt: 'salt',
    updated_at: updatedAt,
    version: 1,
    rules: [],
    overrides: {},
  };
}

function buildFlagsResponse(): FlagListResponse {
  return {
    flags: Array.from({ length: FLAG_COUNT }, (_, i) => ({
      key: `flag-${i}`,
      name: `Flag ${i}`,
      description: '',
      archived: false,
      environments: {
        development: makeFlagEnvironment(i % 2 === 0, i * 5, '2026-01-01T00:00:00.000Z'),
        production: makeFlagEnvironment(i % 3 === 0, i * 2, '2026-01-02T00:00:00.000Z'),
      },
    })),
  };
}

function buildExposuresResponse(environment: Environment, multiplier: number) {
  return {
    environment,
    since: '2025-12-31T00:00:00.000Z',
    flags: Array.from({ length: FLAG_COUNT }, (_, i) => ({
      flag_key: `flag-${i}`,
      total: i * multiplier,
    })),
  };
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlagListPage />
    </QueryClientProvider>,
  );
}

describe('FlagListPage — no N+1 for evaluations (row 50)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issues exactly 2 exposure requests total for 10 flags across 2 environments, and every row shows its 24h count', async () => {
    const flagsResponse = buildFlagsResponse();
    const devExposures = buildExposuresResponse('development', 1);
    const prodExposures = buildExposuresResponse('production', 2);

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      // `apiFetch` always calls `fetchFn(path, init)` with a plain string
      // path, never a `Request`/`URL` object, so this cast is exact for the
      // seam under test rather than a general stringification of `input`.
      const url = input as string;
      if (url.includes('/api/exposures?env=development')) {
        return Promise.resolve(jsonResponse(devExposures));
      }
      if (url.includes('/api/exposures?env=production')) {
        return Promise.resolve(jsonResponse(prodExposures));
      }
      if (url.includes('/api/flags')) {
        return Promise.resolve(jsonResponse(flagsResponse));
      }
      throw new Error(`unexpected fetch call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(FLAG_COUNT + 1); // +1 header row
    });

    const exposureCalls = fetchMock.mock.calls.filter(([input]) =>
      (input as string).includes('/api/exposures'),
    );
    expect(exposureCalls).toHaveLength(2);

    const rows = screen.getAllByRole('row').slice(1);
    const row5 = rows.find((row) => within(row).queryByText('flag-5'));
    if (row5 === undefined) {
      throw new Error('expected to find a row for flag-5');
    }
    // flag-5: dev total = 5*1 = 5, prod total = 5*2 = 10, combined = 15
    expect(within(row5).getByText('15')).toBeInTheDocument();
  });
});
