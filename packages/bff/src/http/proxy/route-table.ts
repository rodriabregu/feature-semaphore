/**
 * The declarative routing tree for the proxy (design Part 1 §4, Part 2 §10.1).
 * `register-proxy.ts` iterates `PROXY_ROUTES` and is the ONLY module in
 * `packages/bff` allowed to call `app.route` — enforced by the ESLint
 * carve-out in `eslint.config.js`, not by convention. A path absent from this
 * table is a Fastify 404 by construction.
 */
export interface ProxyRoute {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  /** Path AFTER the BFF's `/api` prefix; identical to the upstream path after `/api/v1`. */
  readonly path: string;
  /**
   * DECLARED, never derived from `method` — the spec's own wording (`#1894`
   * amended, X2 resolved). `POST /evaluate/preview` is a pure read that writes
   * no audit row (verified at
   * `packages/server/src/infrastructure/http/routes/evaluate.routes.ts:14-19`)
   * and is the most valuable screen of a read-only demo — a method-derived
   * rule would 403 it. An undeclared route fails closed as mutating (row 28).
   */
  readonly mutating: boolean;
}

/**
 * B3a ships this EMPTY, deliberately. The security boundary (the table, the
 * registrar, the fail-closed gate, the ESLint rule) is proven against fixture
 * rows in `http/__tests__/test-bff.ts` before any real proxied route exists
 * (design Part 2 §10.1 slice note). B3b adds the first three real rows;
 * B4/B5 add the rest. Do not add real rows here in this slice.
 */
export const PROXY_ROUTES = [] as const satisfies readonly ProxyRoute[];
