import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Clock } from '../../ports/clock.js';
import type { Delay } from '../../ports/delay.js';
import { createMemorySessionStore } from '../../session/session-store.js';
import { SESSION_COOKIE_NAME, sessionGuardPlugin } from '../plugins/session-guard.js';
import { registerProxyRoutes } from '../proxy/register-proxy.js';
import type { ProxyRoute } from '../proxy/route-table.js';

/** Never a real network target — every test supplies a fake `fetchFn`. */
const TEST_UPSTREAM_URL = 'http://upstream.test';

/**
 * Never a real credential — the fixed test double injected into `forward()`'s
 * outbound `Authorization` header (design Part 1 §4). Exported so fidelity
 * tests can assert the exact forwarded value (row 33) without duplicating
 * the literal.
 */
export const TEST_ADMIN_API_KEY = 'fs_admin_test-key';

export interface BuildTestBffOptions {
  /** Fake upstream, mirroring `packages/sdk-node/src/http-transport.ts:14-15`. */
  readonly fetchFn: typeof fetch;
  /** Frozen, mirroring `packages/server/.../test-app.ts:67`. Drives session minting below. */
  readonly clock: Clock;
  /** Fake, recording requested ms and resolving immediately. Reserved: no throttle lives in this harness. */
  readonly delay: Delay;
  /** Parsed once at composition in production; passed directly here. */
  readonly readOnly: boolean;
  /** Fixture rows in earlier slices' own tests; `PROXY_ROUTES` rows from B3b onward. */
  readonly routes: readonly ProxyRoute[];
  /**
   * A writable sink for the app's logger — e.g. to assert an upstream
   * failure was logged, not silently swallowed (row 40). Mirrors
   * `packages/server/.../test-app.ts:60`. Defaults to a disabled logger
   * DELIBERATELY: the composition root now logs for real (S1), so a test
   * that does not assert on log output should stay quiet rather than
   * mirror production's logger.
   */
  readonly logStream?: { write(chunk: string): boolean };
}

export interface TestBff {
  readonly app: FastifyInstance;
  /**
   * Mints a live session directly in the store, bypassing login/throttle —
   * production's proxy scope sits behind `sessionGuardPlugin` exactly like
   * this harness now does (design Part 2 §12: ① session-guard, ② read-only
   * gate), so a real-route forwarding test needs a valid session to reach
   * `forward()`. Returns a ready-to-use `Cookie` header value.
   */
  readonly mintSessionCookie: () => string;
}

/**
 * Mirrors `packages/server/src/infrastructure/http/__tests__/test-app.ts:64-126`:
 * a full app wired against injected seams — no network, no Docker. Scoped to
 * the proxy alone (`registerProxyRoutes` + `sessionGuardPlugin`, mounted
 * under `/api` to match `forward.ts`'s raw-suffix math exactly); B3a shipped
 * an EMPTY production `PROXY_ROUTES`, so every test here supplies its own
 * fixture rows through `options.routes`.
 */
export function buildTestBff(options: BuildTestBffOptions): TestBff {
  const app = options.logStream
    ? Fastify({ logger: { level: 'error', stream: options.logStream } })
    : Fastify({ logger: false });
  const sessions = createMemorySessionStore();

  void app.register(fastifyCookie);

  // `/api` prefix — `forward.ts`'s upstream URL is built from
  // `request.url.slice('/api'.length)` (design Part 2 §10.3), so the harness
  // must mount real routes at the same prefix production does, or the raw
  // suffix math this batch's own fidelity tests exercise (row 39) would be
  // testing a path shape that never occurs for real.
  void app.register(
    (instance, _opts, done) => {
      sessionGuardPlugin(instance, { sessions, clock: options.clock });
      registerProxyRoutes(instance, {
        readOnly: options.readOnly,
        routes: options.routes,
        fetchFn: options.fetchFn,
        upstreamUrl: TEST_UPSTREAM_URL,
        adminApiKey: TEST_ADMIN_API_KEY,
      });
      done();
    },
    { prefix: '/api' },
  );

  return {
    app,
    mintSessionCookie: () => {
      const record = sessions.create(options.clock.now());
      return `${SESSION_COOKIE_NAME}=${record.id}`;
    },
  };
}
