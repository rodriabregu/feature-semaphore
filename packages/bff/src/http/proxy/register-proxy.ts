import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendBffProblem } from '../problem.js';
import { forward } from './forward.js';
import { registerApiNotFound } from './api-not-found.js';
import type { ProxyRoute } from './route-table.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Set per-route by `registerProxyRoutes` below from `ProxyRoute.mutating`. */
    mutating?: boolean;
  }
}

export interface ProxyDeps {
  /** Parsed once at composition and frozen into the gate's closure (design D3 §4). */
  readonly readOnly: boolean;
  /** `PROXY_ROUTES` in production; fixture rows in this slice's own tests. */
  readonly routes: readonly ProxyRoute[];
  /** Injectable seam — mirrors `packages/sdk-node/src/http-transport.ts:14-15`. */
  readonly fetchFn: typeof fetch;
  readonly upstreamUrl: string;
  /**
   * Injected only into `forward()`'s outbound `Authorization` header — never
   * read from an incoming request, never logged (design Part 1 §4's
   * "ADMIN_API_KEY reaching the browser" threat row).
   */
  readonly adminApiKey: string;
}

/**
 * The SOLE module in `packages/bff` that calls `app.route` for proxied paths
 * (design D3 §4) — enforced by the `no-restricted-syntax` carve-out in
 * `eslint.config.js`, the same technique already used for `packages/core`
 * purity (`eslint.config.js:43-84`). A path absent from `deps.routes` is a
 * Fastify 404 by construction, never a runtime check.
 */
export function registerProxyRoutes(app: FastifyInstance, deps: ProxyDeps): void {
  // Scoped 404 (design D1) — the one call site both `buildApp` and
  // `http/__tests__/test-bff.ts` share, so an unregistered `/api/*` path
  // returns `application/problem+json`, never Fastify's default JSON 404.
  registerApiNotFound(app);

  // `onRequest` — runs BEFORE Fastify parses the body, so a read-only 403 on
  // a large mutating payload never allocates it (design D3 §4). Registered on
  // this instance directly, so it also covers any route registered on it
  // afterward, including a malformed fixture row a test adds by hand.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.readOnly) return;
    // Pre-authorised fix (design D3 §12, T3.3): an unmatched path can never
    // reach `forward()` regardless of this hook — `registerApiNotFound`'s
    // scoped handler always answers it with 404 — so it can neither mutate
    // nor leak. `request.is404` is Fastify's own discriminator for "this
    // request never matched a route" (`config.url === undefined`), which is
    // NOT the same case as `mutating === undefined` below: a row that
    // skipped the type system on a REGISTERED route still fails closed.
    if (request.is404) return;
    // Fails CLOSED: `mutating === false` is the ONLY bypass. `undefined`
    // (a row that skipped the type system, e.g. via a cast) is mutating,
    // same as `true` (row 28). `as const satisfies` makes this unreachable
    // through `PROXY_ROUTES` itself; the hook refuses it anyway.
    if (request.routeOptions.config.mutating === false) return;
    await sendBffProblem(reply, 'read_only', request.url);
  });

  // Encapsulated so the raw-body parser below never reaches sibling scopes
  // (e.g. `routes/session.routes.ts`'s JSON login body) — Fastify content
  // type parsers are scoped per-plugin, unlike the `onRequest` hook above,
  // which was added directly on `app` and therefore covers every route
  // registered on it or any of its children (including this one).
  void app.register((instance, _opts, done) => {
    // Body fidelity is byte-for-byte in BOTH directions (design Part 1 §4):
    // Fastify's default JSON parser would decode then re-serialise a
    // mutating request body, risking key reordering and silently dropping a
    // future `problem+json` extension. Capturing the raw buffer for every
    // content type (including none) keeps `forward()` a pure passthrough.
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload, parserDone) => {
      parserDone(null, payload);
    });

    for (const route of deps.routes) {
      instance.route({
        method: route.method,
        url: route.path,
        config: { mutating: route.mutating },
        handler: (request: FastifyRequest, reply: FastifyReply) => forward(deps, request, reply),
      });
    }

    done();
  });
}
