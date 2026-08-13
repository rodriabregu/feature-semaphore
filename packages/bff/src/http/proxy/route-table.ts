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
 * B3a shipped this EMPTY, deliberately, proving the security boundary (the
 * table, the registrar, the fail-closed gate, the ESLint rule) against
 * fixture rows before any real proxied route existed (design Part 2 §10.1
 * slice note). B3b adds the first three real rows below — flags reads and
 * the config mutation. `POST /flags` and `POST /flags/:key/archive` are
 * deliberately absent (verified at
 * `packages/server/src/infrastructure/http/routes/flags.routes.ts:28, 52`):
 * `#1891` puts creation/archive UI out of scope, and absence means 404 —
 * enforcement, not a comment (row 32).
 */
export const PROXY_ROUTES = [
  { method: 'GET', path: '/flags', mutating: false },
  { method: 'GET', path: '/flags/:key', mutating: false },
  { method: 'PATCH', path: '/flags/:key/config/:env', mutating: true },
  // B4: rules and overrides share config's exact If-Match/ETag/412 fidelity
  // (row 43) — no new `forward.ts` logic, only these declarative rows.
  { method: 'PUT', path: '/flags/:key/config/:env/rules', mutating: true },
  { method: 'PUT', path: '/flags/:key/config/:env/overrides', mutating: true },
] as const satisfies readonly ProxyRoute[];
