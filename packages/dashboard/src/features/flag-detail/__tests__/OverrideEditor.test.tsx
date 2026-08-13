import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OverrideEditor } from '../OverrideEditor.js';
import { queryKeys } from '../../../api/query-keys.js';
import type { Environment, FlagWire } from '../../../api/types.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function seedFlagCache(
  queryClient: QueryClient,
  version: number,
  environment: Environment = 'development',
): void {
  queryClient.setQueryData<FlagWire>(queryKeys.flag('checkout-v2'), {
    environments: { [environment]: { version } },
  } as unknown as FlagWire);
}

function renderEditor(
  queryClient: QueryClient,
  overrides: Readonly<Record<string, boolean>>,
  environment: Environment = 'development',
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <OverrideEditor flagKey="checkout-v2" environment={environment} overrides={overrides} />
    </QueryClientProvider>,
  );
}

describe('OverrideEditor — per-unit overrides (design D5)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives every control a descriptive, resolvable accessible name', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 4);

    renderEditor(queryClient, { 'user-1': true });

    expect(screen.getByLabelText('Unit ID — override 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Serve — override 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove override 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add override' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save overrides' })).toBeInTheDocument();
  });

  it('submits the full override set through useVersionedMutation only', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ version: 5 })));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 4);

    renderEditor(queryClient, { 'user-1': true, 'user-2': false });

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/flags/checkout-v2/config/development/overrides');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['if-match']).toBe('4');
    expect(JSON.parse(init.body as string)).toEqual({
      overrides: [
        { unit_id: 'user-1', serve: true },
        { unit_id: 'user-2', serve: false },
      ],
    });
  });

  it('disables Save when a unit id is empty or duplicated', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 4);

    renderEditor(queryClient, { 'user-1': true });

    await userEvent.click(screen.getByRole('button', { name: 'Add override' }));
    expect(screen.getByRole('button', { name: 'Save overrides' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Unit ID — override 2'), 'user-1');
    expect(screen.getByRole('button', { name: 'Save overrides' })).toBeDisabled();
  });

  it('gates Save behind a confirmation modal in production, never mutating until confirmed (D5b)', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ version: 5 })));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 4, 'production');

    renderEditor(queryClient, { 'user-1': true }, 'production');

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));

    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Flag: checkout-v2')).toBeInTheDocument();
    expect(within(dialog).getByText('Environment: production')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/flags/checkout-v2/config/production/overrides');
    expect(init.method).toBe('PUT');
  });
});
