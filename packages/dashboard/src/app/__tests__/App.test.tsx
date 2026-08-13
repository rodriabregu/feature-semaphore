import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import type { FlagWire } from '../../api/types.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function navigateTo(path: string): void {
  window.history.pushState({}, '', path);
}

function makeFlag(key: string): FlagWire {
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
    key,
    name: key,
    description: '',
    archived: false,
    environments: {
      development: env(true, 20, 3),
      production: env(false, 0, 5),
    },
  };
}

/**
 * Drives the real production `App` and its real `BrowserRouter` — not a
 * bespoke harness rendering a screen or dialog in isolation. This is the
 * regression guard for the wiring gap `#1926`/`#1925` recorded: components
 * built and unit-tested in prior batches (confirmation dialogs, RuleEditor,
 * OverrideEditor) shipped with zero importers outside their own tests. A test
 * that only rendered `FlagDetailPage` directly through `MemoryRouter` would
 * NOT have caught `App.tsx` never routing to it — this suite proves the
 * route itself resolves through the actual app shell.
 */
describe('App — production router wiring (D5b)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    navigateTo('/');
  });

  it('reaches FlagDetailPage via /flags/:flagKey through the real router, and gates a production toggle behind typing the flag key', async () => {
    const flag = makeFlag('app-wiring-flag');
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = input as string;
      if (url.includes('/config/production')) {
        return Promise.resolve(jsonResponse({ version: 6 }));
      }
      return Promise.resolve(jsonResponse(flag));
    });
    vi.stubGlobal('fetch', fetchMock);
    navigateTo('/flags/app-wiring-flag');

    render(<App />);

    await screen.findByRole('heading', { name: 'app-wiring-flag' });
    await userEvent.click(screen.getByLabelText('Enabled — production'));

    const dialog = await screen.findByRole('dialog');
    expect(
      fetchMock.mock.calls.some(([input]) => (input as string).includes('/config/production')),
    ).toBe(false);

    await userEvent.type(
      within(dialog).getByLabelText('Type "app-wiring-flag" to confirm'),
      'app-wiring-flag',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => (input as string).includes('/config/production')),
      ).toBe(true);
    });
  });

  it('reaches PreviewPage via /preview through the real router (D6)', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          value: true,
          reason: 'FLAG_OFF',
          flag_key: 'app-wiring-preview',
          environment: 'development',
          candidate_applied: false,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    navigateTo('/preview');

    render(<App />);

    await screen.findByRole('heading', { name: 'Preview' });
    await userEvent.type(screen.getByLabelText('Flag key'), 'app-wiring-preview');
    await userEvent.type(screen.getByLabelText('Unit ID'), 'user-1');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await screen.findByText('Reason: Flag disabled');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/evaluate/preview',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
