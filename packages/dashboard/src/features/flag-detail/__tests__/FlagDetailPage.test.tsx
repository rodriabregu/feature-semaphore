import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FlagDetailPage } from '../FlagDetailPage.js';
import type { FlagWire } from '../../../api/types.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFlag(): FlagWire {
  const env = (enabled: boolean, rolloutPercentage: number, version: number) => ({
    enabled,
    off_value: false,
    on_value: true,
    rollout_percentage: rolloutPercentage,
    salt: 'salt',
    updated_at: '2026-01-01T00:00:00.000Z',
    version,
    rules: [],
    overrides: {},
  });
  return {
    key: 'checkout-v2',
    name: 'Checkout v2',
    description: '',
    archived: false,
    environments: {
      development: env(true, 20, 3),
      production: env(false, 0, 5),
    },
  };
}

function renderDetail(queryClient: QueryClient): void {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/flags/checkout-v2']}>
        <Routes>
          <Route path="/flags/:flagKey" element={<FlagDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FlagDetailPage — read view and toggle mutation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the enabled state and rollout percentage for both environments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(makeFlag()))),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderDetail(queryClient);

    await screen.findByRole('heading', { name: 'checkout-v2' });
    expect(screen.getByLabelText('Enabled — development')).toBeChecked();
    expect(screen.getByLabelText('Enabled — production')).not.toBeChecked();
    expect(screen.getByLabelText('Rollout percentage — development')).toHaveValue('20');
  });

  it('toggling enabled sends a PATCH with if-match equal to the cached version', async () => {
    const flag = makeFlag();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = input as string;
      if (url.includes('/config/development')) {
        return Promise.resolve(jsonResponse({ version: 4 }));
      }
      return Promise.resolve(jsonResponse(flag));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderDetail(queryClient);
    await screen.findByRole('heading', { name: 'checkout-v2' });

    await userEvent.click(screen.getByLabelText('Enabled — development'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        (input as string).includes('/config/development'),
      );
      expect(call).toBeDefined();
    });
    const call = fetchMock.mock.calls.find(([input]) =>
      (input as string).includes('/config/development'),
    );
    if (call === undefined) {
      throw new Error('expected a PATCH call to the development config route');
    }
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['if-match']).toBe('3');
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
  });
});
