import Fastify, { type FastifyInstance } from 'fastify';
import type { Clock } from '../../ports/clock.js';
import type { Delay } from '../../ports/delay.js';
import { registerProxyRoutes } from '../proxy/register-proxy.js';
import type { ProxyRoute } from '../proxy/route-table.js';

/** Never a real network target — every test supplies a fake `fetchFn`. */
const TEST_UPSTREAM_URL = 'http://upstream.test';

export interface BuildTestBffOptions {
  /** Fake upstream, mirroring `packages/sdk-node/src/http-transport.ts:14-15`. */
  readonly fetchFn: typeof fetch;
  /**
   * Frozen, mirroring `packages/server/.../test-app.ts:67`. Reserved for when
   * this harness grows a session/login surface (expected no later than
   * B3b's "a fresh session" rows) — this slice's own tests (rows 26–31) need
   * no authentication: the read-only gate is a hook beside the session guard
   * (design Part 1 §4), not gated by it.
   */
  readonly clock: Clock;
  /** Fake, recording requested ms and resolving immediately. Reserved, see `clock`. */
  readonly delay: Delay;
  /** Parsed once at composition in production; passed directly here. */
  readonly readOnly: boolean;
  /** Fixture rows in this slice's own tests; `PROXY_ROUTES` from B3b onward. */
  readonly routes: readonly ProxyRoute[];
}

export interface TestBff {
  readonly app: FastifyInstance;
}

/**
 * Mirrors `packages/server/src/infrastructure/http/__tests__/test-app.ts:64-126`:
 * a full app wired against injected seams — no network, no Docker. Scoped to
 * the proxy alone for this slice (registerProxyRoutes only); B3a ships an
 * EMPTY production `PROXY_ROUTES`, so every test here supplies its own
 * fixture rows through `options.routes`.
 */
export function buildTestBff(options: BuildTestBffOptions): TestBff {
  const app = Fastify({ logger: false });

  registerProxyRoutes(app, {
    readOnly: options.readOnly,
    routes: options.routes,
    fetchFn: options.fetchFn,
    upstreamUrl: TEST_UPSTREAM_URL,
  });

  return { app };
}
