import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('FlagDetailPage — tiered production confirmation (D5b)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gates a production enabled toggle behind typing the exact flag key, never mutating until it matches', async () => {
    const flag = makeFlag();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = input as string;
      if (url.includes('/config/production')) {
        return Promise.resolve(jsonResponse({ version: 6 }));
      }
      return Promise.resolve(jsonResponse(flag));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderDetail(queryClient);
    await screen.findByRole('heading', { name: 'checkout-v2' });

    await userEvent.click(screen.getByLabelText('Enabled — production'));

    const dialog = await screen.findByRole('dialog');
    expect(
      fetchMock.mock.calls.some(([input]) => (input as string).includes('/config/production')),
    ).toBe(false);

    const confirmButton = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirmButton).toBeDisabled();

    const typedInput = within(dialog).getByLabelText('Type "checkout-v2" to confirm');
    await userEvent.type(typedInput, 'checkout-v2');
    expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        (input as string).includes('/config/production'),
      );
      expect(call).toBeDefined();
    });
    const call = fetchMock.mock.calls.find(([input]) =>
      (input as string).includes('/config/production'),
    );
    if (call === undefined) {
      throw new Error('expected a PATCH call to the production config route');
    }
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
  });

  it('blocks the production toggle mutation while the typed text does not match the flag key', async () => {
    const flag = makeFlag();
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(flag)));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderDetail(queryClient);
    await screen.findByRole('heading', { name: 'checkout-v2' });

    await userEvent.click(screen.getByLabelText('Enabled — production'));
    const dialog = await screen.findByRole('dialog');
    const typedInput = within(dialog).getByLabelText('Type "checkout-v2" to confirm');
    await userEvent.type(typedInput, 'wrong-key');

    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(
      fetchMock.mock.calls.some(([input]) => (input as string).includes('/config/production')),
    ).toBe(false);
  });

  it('gates a production rollout change behind a confirmation modal showing the target state', async () => {
    const flag = makeFlag();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = input as string;
      if (url.includes('/config/production')) {
        return Promise.resolve(jsonResponse({ version: 9 }));
      }
      return Promise.resolve(jsonResponse(flag));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderDetail(queryClient);
    await screen.findByRole('heading', { name: 'checkout-v2' });

    const slider = screen.getByLabelText('Rollout percentage — production');
    fireEvent.change(slider, { target: { value: '42' } });
    fireEvent.mouseUp(slider);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Flag: checkout-v2')).toBeInTheDocument();
    expect(within(dialog).getByText('Environment: production')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => (input as string).includes('/config/production')),
    ).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        (input as string).includes('/config/production'),
      );
      expect(call).toBeDefined();
    });
    const call = fetchMock.mock.calls.find(([input]) =>
      (input as string).includes('/config/production'),
    );
    if (call === undefined) {
      throw new Error('expected a PATCH call to the production config route');
    }
    const [, init] = call as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ rollout_percentage: 42 });
  });

  it('never confirms a development toggle or rollout change — mutations submit immediately', async () => {
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

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => (input as string).includes('/config/development')),
      ).toBe(true);
    });
  });

  it('mounts the rule editor and override editor for each environment', async () => {
    const flag = makeFlag();
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(flag)));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderDetail(queryClient);
    await screen.findByRole('heading', { name: 'checkout-v2' });

    expect(screen.getAllByRole('button', { name: 'Save rules' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Save overrides' })).toHaveLength(2);
  });
});
