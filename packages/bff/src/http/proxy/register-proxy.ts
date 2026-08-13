import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendBffProblem } from '../problem.js';
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
}

/**
 * The SOLE module in `packages/bff` that calls `app.route` for proxied paths
 * (design D3 §4) — enforced by the `no-restricted-syntax` carve-out in
 * `eslint.config.js`, the same technique already used for `packages/core`
 * purity (`eslint.config.js:43-84`). A path absent from `deps.routes` is a
 * Fastify 404 by construction, never a runtime check.
 */
export function registerProxyRoutes(app: FastifyInstance, deps: ProxyDeps): void {
  // `onRequest` — runs BEFORE Fastify parses the body, so a read-only 403 on
  // a large mutating payload never allocates it (design D3 §4). Registered on
  // this instance directly, so it also covers any route registered on it
  // afterward, including a malformed fixture row a test adds by hand.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.readOnly) return;
    // Fails CLOSED: `mutating === false` is the ONLY bypass. `undefined`
    // (a row that skipped the type system, e.g. via a cast) is mutating,
    // same as `true` (row 28). `as const satisfies` makes this unreachable
    // through `PROXY_ROUTES` itself; the hook refuses it anyway.
    if (request.routeOptions.config.mutating === false) return;
    await sendBffProblem(reply, 'read_only', request.url);
  });

  for (const route of deps.routes) {
    app.route({
      method: route.method,
      url: route.path,
      config: { mutating: route.mutating },
      handler: (request, reply) => forwardToUpstream(deps, request, reply),
    });
  }
}

/**
 * Minimal forwarding for this slice's fixture rows only: no header
 * allow-lists, no raw-suffix path construction, no `If-Match` fidelity, no
 * 502 handling. Full fidelity (design Part 1 §4, Part 2 §10.3) arrives with
 * `forward.ts` in B3b, which will replace this call once real routes exist —
 * B3a's own rollback boundary names only `route-table.ts`/`register-proxy.ts`,
 * not `forward.ts`.
 */
async function forwardToUpstream(
  deps: ProxyDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const response = await deps.fetchFn(`${deps.upstreamUrl}${request.url}`, {
    method: request.method,
  });
  const body = await response.text();
  reply.code(response.status).send(body);
}
