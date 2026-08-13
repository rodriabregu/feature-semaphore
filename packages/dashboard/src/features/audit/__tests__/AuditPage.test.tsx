import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditPage } from '../AuditPage.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

describe('AuditPage — before/after diff and honest actor labelling (row 61)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a rollout_percentage diff visually distinguished as before vs after, and labels the actor as a system/API-key identity', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          entries: [
            {
              actor: 'key-abc123',
              flagKey: 'checkout-v2',
              environment: 'production',
              action: 'config.updated',
              before: { rollout_percentage: 20, enabled: true },
              after: { rollout_percentage: 35, enabled: true },
              createdAt: '2026-01-05T12:00:00.000Z',
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderPage(queryClient);

    await userEvent.type(screen.getByLabelText('Flag key'), 'checkout-v2');
    await userEvent.click(screen.getByRole('button', { name: 'Load audit log' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/flags/checkout-v2/audit?limit=50',
        expect.anything(),
      );
    });

    const row = await screen.findByRole('row', { name: /rollout_percentage/i });
    expect(within(row).getByText('20')).toBeInTheDocument();
    expect(within(row).getByText('35')).toBeInTheDocument();
    // The changed value must be marked up as a real semantic change, not a
    // plain cell — this is the "visually distinguished" requirement.
    expect(within(row).getByText('20').closest('del')).not.toBeNull();
    expect(within(row).getByText('35').closest('ins')).not.toBeNull();

    // enabled is unchanged — never wrapped in <del>/<ins>.
    const enabledRow = screen.getByRole('row', { name: /^enabled/i });
    expect(enabledRow.querySelector('del')).toBeNull();
    expect(enabledRow.querySelector('ins')).toBeNull();

    // The actor is an opaque api_keys.id — never rendered as a human name.
    expect(screen.getByText(/system/i)).toHaveTextContent('key-abc123');
    expect(screen.queryByText(/^(alice|bob|admin user)$/i)).not.toBeInTheDocument();
  });

  it('caps the requested limit at 500 and defaults to 50', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ entries: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderPage(queryClient);

    await userEvent.type(screen.getByLabelText('Flag key'), 'checkout-v2');
    await userEvent.clear(screen.getByLabelText('Limit'));
    await userEvent.type(screen.getByLabelText('Limit'), '9999');
    await userEvent.click(screen.getByRole('button', { name: 'Load audit log' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/flags/checkout-v2/audit?limit=500',
        expect.anything(),
      );
    });
  });
});
