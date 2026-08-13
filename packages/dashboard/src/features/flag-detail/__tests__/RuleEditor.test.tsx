import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuleEditor } from '../RuleEditor.js';
import { queryKeys } from '../../../api/query-keys.js';
import type { Environment, FlagWire, RuleWire } from '../../../api/types.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeRules(): RuleWire[] {
  return [
    { attribute: 'plan', operator: 'in', values: ['pro'], serve: true, rollout: 100 },
    { attribute: 'country', operator: 'not_in', values: ['XX'], serve: false, rollout: 0 },
  ];
}

/** Seeds only what `useVersionedMutation` reads: the cache entry's version. */
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
  rules: RuleWire[],
  environment: Environment = 'development',
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <RuleEditor flagKey="checkout-v2" environment={environment} rules={rules} />
    </QueryClientProvider>,
  );
}

describe('RuleEditor — ordered rule editor (row 59)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives every control a descriptive, resolvable accessible name', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 7);

    renderEditor(queryClient, makeRules());

    expect(screen.getByLabelText('Attribute — rule 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Operator — rule 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Values — rule 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Serve — rule 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Rollout % — rule 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move rule 1 down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove rule 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeInTheDocument();
  });

  it('submits the ordered rule set through useVersionedMutation only', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ version: 8 })));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 7);

    renderEditor(queryClient, makeRules());

    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/flags/checkout-v2/config/development/rules');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['if-match']).toBe('7');
    expect(JSON.parse(init.body as string)).toEqual({ rules: makeRules() });
  });

  it('reorders via keyboard-operable move buttons, not drag-only — changes submission order', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ version: 9 })));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 7);

    renderEditor(queryClient, makeRules());

    screen.getByRole('button', { name: 'Move rule 1 down' }).focus();
    await userEvent.keyboard('{Enter}');

    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { rules: RuleWire[] };
    expect(body.rules.map((rule) => rule.attribute)).toEqual(['country', 'plan']);
  });

  it('disables Save while any rule draft is invalid, per the mirrored operator/values shape', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 7);

    renderEditor(queryClient, makeRules());

    await userEvent.clear(screen.getByLabelText('Values — rule 1'));

    expect(screen.getByRole('button', { name: 'Save rules' })).toBeDisabled();
  });

  it('gates Save behind a confirmation modal in production, never mutating until confirmed (D5b)', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ version: 8 })));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedFlagCache(queryClient, 7, 'production');

    renderEditor(queryClient, makeRules(), 'production');

    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Flag: checkout-v2')).toBeInTheDocument();
    expect(within(dialog).getByText('Environment: production')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/flags/checkout-v2/config/production/rules');
    expect(init.method).toBe('PUT');
  });
});
