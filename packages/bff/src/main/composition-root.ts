import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { CompositionConfig } from './env.js';
import { createSystemClock } from '../system-clock.js';
import { createTimersDelay } from '../timers-delay.js';
import { createLoginThrottle } from '../http/plugins/login-throttle.js';
import { registerSessionRoutes } from '../http/routes/session.routes.js';
import { createMemorySessionStore } from '../session/session-store.js';
import { sessionGuardPlugin } from '../http/plugins/session-guard.js';
import { registerProxyRoutes } from '../http/proxy/register-proxy.js';
import { PROXY_ROUTES } from '../http/proxy/route-table.js';
import { registerDashboard } from '../http/static/register-dashboard.js';
import { createBffLogger, type BffLoggerOverrides } from './logger.js';

export type { CompositionConfig } from './env.js';

export interface Composition {
  readonly app: FastifyInstance;
  /**
   * Flips `/readyz` from 503 to 200. Kept as an explicit, caller-controlled
   * step — mirroring `packages/server/src/main/composition-root.ts` — so the
   * pre-ready window is observable rather than a timing race, even though
   * the BFF has no migration to await yet.
   */
  readonly start: () => Promise<void>;
}

/**
 * Wires the session/login slice — the memory session store, the injectable
 * `Delay`-backed login throttle, and `@fastify/cookie` with signing
 * disabled (the token is opaque and the store is authoritative, so a
 * signature would guard nothing) — AND the proxy scope: every
 * `PROXY_ROUTES` row is registered under `/api`, guarded by
 * `sessionGuardPlugin` then the read-only gate inside
 * `registerProxyRoutes` (design Part 2 §12: ① session-guard, ② read-only
 * gate). This mirrors exactly how `http/__tests__/test-bff.ts` mounts the
 * same two plugins under the same `/api` prefix for its own fidelity
 * tests — the two assemblies must agree, and `main/__tests__/composition-root.test.ts`
 * proves it by driving this function directly rather than that harness (`#1921`).
 *
 * `fetchFn` defaults to the global `fetch` and exists purely as a test seam,
 * mirroring `packages/server/src/main/composition-root.ts`'s injected
 * `clock` parameter — production always uses the default.
 */
export async function buildApp(
  config: CompositionConfig,
  fetchFn: typeof fetch = fetch,
  loggerOverrides: BffLoggerOverrides = {},
): Promise<Composition> {
  const app = Fastify({ logger: createBffLogger(loggerOverrides) });
  await app.register(fastifyCookie);

  const clock = createSystemClock();
  const sessions = createMemorySessionStore();
  const delay = createTimersDelay();
  const throttle = createLoginThrottle(delay);

  registerSessionRoutes(app, { config, sessions, clock, throttle });

  void app.register(
    (instance, _opts, done) => {
      sessionGuardPlugin(instance, { sessions, clock });
      registerProxyRoutes(instance, {
        readOnly: config.readOnly,
        routes: PROXY_ROUTES,
        fetchFn,
        upstreamUrl: config.upstreamUrl,
        adminApiKey: config.adminApiKey,
      });
      done();
    },
    { prefix: '/api' },
  );

  // Mounted AFTER the `/api` scope (design D3). The honest reason: three
  // things together keep `/api/*` from being swallowed by the SPA fallback,
  // and only one of them is this ordering.
  //   1. `wildcard: false` inside `registerDashboard` — `@fastify/static`
  //      registers no catch-all route, so no static route can ever match an
  //      `/api` path. THIS is the mechanism that actually carries the
  //      guarantee (verified against the plugin's own docs, `#1984`).
  //   2. The scoped `setNotFoundHandler` registered inside
  //      `registerProxyRoutes` (design D1) — Fastify resolves not-found by
  //      longest registered prefix, so `/api/nope` reaches that handler, not
  //      the root one below.
  //   3. This ordering — registering the root fallback while the `/api`
  //      scope is still pending keeps the two not-found handlers in
  //      distinct contexts. It is real, but it is the WEAKEST of the three:
  //      moving this call above the `/api` register would not by itself
  //      break routing, which is exactly why a future "cleanup" that
  //      reorders these calls while believing it preserves the guarantee is
  //      the trap — the thing actually worth preserving is #1.
  // Proof lives in two places: `main/__tests__/composition-root.test.ts`
  // (T3.1–T3.5, in-process) and the compose smoke job in
  // `.github/workflows/ci.yml` (through the real container).
  registerDashboard(app, { distDir: config.dashboardDistDir });

  let isReady = false;
  app.get('/healthz', (_request, reply: FastifyReply) => {
    reply.send({ status: 'ok' });
  });
  app.get('/readyz', (_request, reply: FastifyReply) => {
    if (!isReady) {
      reply.code(503).send({ status: 'not-ready' });
      return;
    }
    reply.send({ status: 'ready' });
  });

  const start = (): Promise<void> => {
    isReady = true;
    return Promise.resolve();
  };

  return { app, start };
}
