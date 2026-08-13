import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerProxyRoutes } from '../register-proxy.js';
import type { ProxyRoute } from '../route-table.js';

const FIXTURE_ROUTES: readonly ProxyRoute[] = [
  { method: 'GET', path: '/widgets', mutating: false },
  { method: 'PATCH', path: '/widgets/:id', mutating: true },
];

describe('registerProxyRoutes — the registered tree is exactly the supplied rows (row 26)', () => {
  it('registers every supplied row and nothing else', async () => {
    const app = Fastify({ logger: false });
    registerProxyRoutes(app, {
      readOnly: false,
      routes: FIXTURE_ROUTES,
      fetchFn: () => Promise.resolve(new Response(null, { status: 204 })),
      upstreamUrl: 'http://upstream.test',
    });
    await app.ready();

    for (const route of FIXTURE_ROUTES) {
      expect(app.hasRoute({ method: route.method, url: route.path })).toBe(true);
    }

    // No extra route was registered — neither an unsupplied method on a
    // supplied path, nor a path never supplied at all.
    expect(app.hasRoute({ method: 'POST', url: '/widgets' })).toBe(false);
    expect(app.hasRoute({ method: 'DELETE', url: '/widgets/:id' })).toBe(false);
    expect(app.hasRoute({ method: 'GET', url: '/never-supplied' })).toBe(false);
  });

  it('registers nothing when the route list is empty — the production PROXY_ROUTES shape for this slice', async () => {
    const app = Fastify({ logger: false });
    registerProxyRoutes(app, {
      readOnly: false,
      routes: [],
      fetchFn: () => Promise.resolve(new Response(null, { status: 204 })),
      upstreamUrl: 'http://upstream.test',
    });
    await app.ready();

    expect(app.hasRoute({ method: 'GET', url: '/widgets' })).toBe(false);
  });
});

describe('ProxyRoute — `mutating` is required, never optional (row 27)', () => {
  it('is a compile-time error to omit `mutating` from a route entry', () => {
    // @ts-expect-error — `mutating` is required on every ProxyRoute; a row
    // without it must fail `tsc`, not merely default at runtime. Proven by
    // removing this directive locally and observing `pnpm typecheck` fail.
    const badRow: ProxyRoute = { method: 'GET', path: '/x' };

    // Runtime confirmation that the object above really lacks the field —
    // the `@ts-expect-error` above is the actual guarantee under test.
    expect((badRow as { mutating?: boolean }).mutating).toBeUndefined();
  });
});
