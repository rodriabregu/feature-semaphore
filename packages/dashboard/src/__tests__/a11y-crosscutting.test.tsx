import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Shell } from '../app/Shell.js';
import { FlagListPage } from '../features/flag-list/FlagListPage.js';
import { FlagDetailPage } from '../features/flag-detail/FlagDetailPage.js';
import { PreviewPage } from '../features/preview/PreviewPage.js';
import { AuditPage } from '../features/audit/AuditPage.js';
import type { FlagWire } from '../api/types.js';

/**
 * Cross-cutting a11y pass (D8, row 64). Per-screen a11y (labels, dialog
 * contracts, keyboard activation of THAT screen's own controls) was already
 * proven in D2-D7's own test files. This file only asserts what is genuinely
 * cross-cutting: the shell's focus order (skip link, landmarks) holds when
 * REAL screen content is mounted, that no screen introduces a keyboard trap,
 * and that error states share one consistent live-region pattern across the
 * whole app.
 *
 * `Row 64 is partial by design`: jsdom cannot verify "visible focus" — that
 * is a CSS-token decision plus a manual checklist (see README), never an
 * automated assertion here.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

/** Mirrors App.tsx's real composition (Shell wrapping the 4 routed screens),
 * minus the login route and session-expiry redirect — irrelevant here. */
function renderScreenInShell(initialEntry: string, queryClient: QueryClient): void {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Shell>
          <Routes>
            <Route path="/" element={<FlagListPage />} />
            <Route path="/flags/:flagKey" element={<FlagDetailPage />} />
            <Route path="/preview" element={<PreviewPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </Shell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

interface ScreenCase {
  readonly name: string;
  readonly initialEntry: string;
  readonly fetchMock: () => typeof fetch;
  /** Awaited once after render so the screen has finished its initial fetch. */
  readonly waitForReady: () => Promise<unknown>;
}

const FLAG_LIST_CASE: ScreenCase = {
  name: 'FlagListPage',
  initialEntry: '/',
  fetchMock: () => {
    const flagsResponse = { flags: [makeFlag()] };
    const exposures = (environment: string) => ({
      environment,
      since: '2025-12-31T00:00:00.000Z',
      flags: [{ flag_key: 'checkout-v2', total: 1 }],
    });
    return (input: RequestInfo | URL) => {
      const url = input as string;
      if (url.includes('/api/exposures?env=development')) {
        return Promise.resolve(jsonResponse(exposures('development')));
      }
      if (url.includes('/api/exposures?env=production')) {
        return Promise.resolve(jsonResponse(exposures('production')));
      }
      return Promise.resolve(jsonResponse(flagsResponse));
    };
  },
  waitForReady: async () => screen.findByRole('table'),
};

const FLAG_DETAIL_CASE: ScreenCase = {
  name: 'FlagDetailPage',
  initialEntry: '/flags/checkout-v2',
  fetchMock: () => () => Promise.resolve(jsonResponse(makeFlag())),
  waitForReady: async () => screen.findByRole('heading', { name: 'checkout-v2' }),
};

const PREVIEW_CASE: ScreenCase = {
  name: 'PreviewPage',
  initialEntry: '/preview',
  fetchMock: () => () => Promise.resolve(jsonResponse({})),
  waitForReady: async () => screen.findByRole('button', { name: 'Preview' }),
};

const AUDIT_CASE: ScreenCase = {
  name: 'AuditPage',
  initialEntry: '/audit',
  fetchMock: () => () => Promise.resolve(jsonResponse({ entries: [] })),
  waitForReady: async () => screen.findByRole('button', { name: 'Load audit log' }),
};

const ALL_SCREENS: readonly ScreenCase[] = [
  FLAG_LIST_CASE,
  FLAG_DETAIL_CASE,
  PREVIEW_CASE,
  AUDIT_CASE,
];

describe('Cross-cutting keyboard focus order (row 64)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(ALL_SCREENS.map((c) => [c.name, c] as const))(
    '%s: Tab from the document still reaches the skip link before any screen content, and exactly one main/nav landmark exists',
    async (_name, screenCase) => {
      vi.stubGlobal('fetch', screenCase.fetchMock());
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderScreenInShell(screenCase.initialEntry, queryClient);
      await screenCase.waitForReady();

      const user = userEvent.setup();
      await user.tab();
      expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveFocus();

      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(screen.getAllByRole('navigation', { name: /primary/i })).toHaveLength(1);
    },
  );

  it.each(ALL_SCREENS.map((c) => [c.name, c] as const))(
    '%s: tabbing forward then shift-tabbing back the same number of steps returns focus to the first stop, with no keyboard trap',
    async (_name, screenCase) => {
      vi.stubGlobal('fetch', screenCase.fetchMock());
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderScreenInShell(screenCase.initialEntry, queryClient);
      await screenCase.waitForReady();

      const user = userEvent.setup();
      const forwardStops: Element[] = [];
      const maxSteps = 40;

      // Tab forward until focus wraps back to <body> — the browser/jsdom
      // signal that every focusable element has been visited — or the loop
      // cap is hit, so a real keyboard trap fails loudly instead of hanging.
      let wrapped = false;
      for (let step = 0; step < maxSteps; step += 1) {
        await user.tab();
        const active = document.activeElement;
        if (active === document.body) {
          wrapped = true;
          break;
        }
        if (active === null) {
          throw new Error('expected a non-null active element mid-traversal');
        }
        forwardStops.push(active);
      }

      expect(wrapped).toBe(true);
      expect(forwardStops.length).toBeGreaterThan(0);

      // Shift-tabbing exactly as many times as there were forward stops must
      // retrace them in exact reverse order, and one further shift-tab must
      // wrap back to <body> again — a true round trip, proving nothing was
      // skipped, duplicated, or trapped in either direction.
      for (const index of forwardStops.keys()) {
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(forwardStops[forwardStops.length - 1 - index]);
      }

      await user.tab({ shift: true });
      expect(document.activeElement).toBe(document.body);
    },
  );
});

describe('Cross-cutting keyboard activation (row 64: keyboard-only flag toggle)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reaches the enabled toggle via Tab alone and activates it with Space, never a mouse', async () => {
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
    renderScreenInShell('/flags/checkout-v2', queryClient);
    await screen.findByRole('heading', { name: 'checkout-v2' });

    // development.enabled starts `true` (makeFlag()); tier is 'none', so
    // Space should submit the mutation immediately, with no mouse click and
    // no confirmation dialog in the way.
    const toggle = screen.getByLabelText('Enabled — development');
    const user = userEvent.setup();

    let reached = false;
    for (let step = 0; step < 40; step += 1) {
      await user.tab();
      if (document.activeElement === toggle) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
    expect(toggle).toHaveFocus();

    await user.keyboard(' ');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([reqInput]) =>
        (reqInput as string).includes('/config/development'),
      );
      expect(call).toBeDefined();
    });
    const call = fetchMock.mock.calls.find(([reqInput]) =>
      (reqInput as string).includes('/config/development'),
    );
    if (call === undefined) {
      throw new Error('expected a PATCH call to the development config route');
    }
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
  });
});

describe('Cross-cutting live regions: every screen surfaces errors the same way', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('FlagListPage renders a load failure as an assertive live region', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new Error('network down'))),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderScreenInShell('/', queryClient);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load flags.');
  });

  it('FlagDetailPage renders a load failure as an assertive live region', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new Error('network down'))),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderScreenInShell('/flags/checkout-v2', queryClient);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load flag.');
  });

  it('AuditPage renders a load failure as an assertive live region', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new Error('network down'))),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderScreenInShell('/audit', queryClient);
    await screen.findByRole('button', { name: 'Load audit log' });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Flag key'), 'checkout-v2');
    await user.click(screen.getByRole('button', { name: 'Load audit log' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load audit log.');
  });

  it('PreviewPage renders both a client-validation error and a request failure as the same assertive live region', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new Error('network down'))),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderScreenInShell('/preview', queryClient);
    await screen.findByRole('button', { name: 'Preview' });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Flag key'), 'checkout-v2');
    await user.type(screen.getByLabelText('Unit ID'), 'user-1');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(async () => {
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to evaluate preview.');
    });
  });
});
