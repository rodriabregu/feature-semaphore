import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreviewPage } from '../PreviewPage.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PreviewPage />
    </QueryClientProvider>,
  );
}

describe('PreviewPage — value and reason (row 60)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders both the evaluated value and a human-readable reason label for a rule match', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          value: true,
          reason: 'RULE_MATCH:2',
          flag_key: 'checkout-v2',
          environment: 'production',
          candidate_applied: false,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderPage(queryClient);

    await userEvent.type(screen.getByLabelText('Flag key'), 'checkout-v2');
    await userEvent.selectOptions(screen.getByLabelText('Environment'), 'production');
    await userEvent.type(screen.getByLabelText('Unit ID'), 'user-42');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await screen.findByText('Value: true');
    expect(screen.getByText(/^Reason: /)).toHaveTextContent('Reason: Matched rule 2');
    expect(screen.queryByText(/RULE_MATCH:2/)).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/evaluate/preview');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      flag_key: 'checkout-v2',
      environment: 'production',
      context: { unit_id: 'user-42', attributes: {}, default_value: false },
    });
  });

  it('renders FALLTHROUGH_ROLLOUT as prose, never the raw enum token', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          value: false,
          reason: 'FALLTHROUGH_ROLLOUT',
          flag_key: 'checkout-v2',
          environment: 'development',
          candidate_applied: false,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderPage(queryClient);

    await userEvent.type(screen.getByLabelText('Flag key'), 'checkout-v2');
    await userEvent.type(screen.getByLabelText('Unit ID'), 'user-1');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await screen.findByText('Value: false');
    expect(screen.getByText(/^Reason: /)).toHaveTextContent(
      'Reason: Fell through to the default rollout',
    );
  });

  it('sends the candidate overlay when provided, to preview unsaved edits', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          value: true,
          reason: 'OVERRIDE',
          flag_key: 'checkout-v2',
          environment: 'production',
          candidate_applied: true,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderPage(queryClient);

    await userEvent.type(screen.getByLabelText('Flag key'), 'checkout-v2');
    await userEvent.type(screen.getByLabelText('Unit ID'), 'user-42');
    fireEvent.change(screen.getByLabelText('Candidate overlay (JSON, optional)'), {
      target: { value: '{"rollout_percentage": 100}' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { candidate?: unknown };
    expect(body.candidate).toEqual({ rollout_percentage: 100 });
    await screen.findByText('Candidate applied: yes');
  });

  it('shows an error and does not submit when the candidate overlay is not valid JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderPage(queryClient);

    await userEvent.type(screen.getByLabelText('Flag key'), 'checkout-v2');
    await userEvent.type(screen.getByLabelText('Unit ID'), 'user-42');
    await userEvent.type(screen.getByLabelText('Candidate overlay (JSON, optional)'), 'not json');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/candidate overlay/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
