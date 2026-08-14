/**
 * The BFF's required, fail-fast environment. None of these four has a
 * default: a BFF with no password is a BFF with no door, a missing
 * `UPSTREAM_URL` must never silently fall back to localhost (that is how a
 * demo writes to production), a missing `ADMIN_API_KEY` leaves nothing to
 * authenticate proxied requests with, and a missing `DASHBOARD_DIST_DIR`
 * would otherwise need a default path that is either wrong (serves nothing)
 * or a guess (design D9) — following `UPSTREAM_URL`'s existing precedent.
 */
export interface CompositionConfig {
  readonly upstreamUrl: string;
  readonly adminApiKey: string;
  readonly dashboardPassword: string;
  readonly cookieSecure: boolean;
  readonly readOnly: boolean;
  readonly dashboardDistDir: string;
}

/**
 * Thrown by `readCompositionConfig` when the deployment looks public (design
 * D5) and neither `READ_ONLY_MODE=true` nor the named escape hatch is set.
 * Named so a reader can grep straight to the check that closes the
 * omission gap described below.
 */
export class PublicDeploymentRequiresReadOnlyError extends Error {
  constructor() {
    super(
      'This looks like a public deployment (FLY_APP_NAME or PUBLIC_DEMO=true is set), ' +
        "but READ_ONLY_MODE is not 'true'. Either set READ_ONLY_MODE=true, or set " +
        'ALLOW_WRITES_ON_PUBLIC=true to accept a writable public deployment.',
    );
    this.name = 'PublicDeploymentRequiresReadOnlyError';
  }
}

/**
 * "Public" is derived at least in part from a signal the hosting PLATFORM
 * sets (`FLY_APP_NAME`, injected by Fly itself), not solely from an
 * operator-set variable — `PUBLIC_DEMO` is kept as an OR so the assertion
 * stays testable and usable off-Fly, but an operator who forgets it forgets
 * it right alongside `READ_ONLY_MODE` in the same `fly.toml` `[env]` block
 * (design D5) — that only relocates the omission gap, it does not close it.
 */
function isPublicDeployment(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env.FLY_APP_NAME !== undefined || env.PUBLIC_DEMO === 'true';
}

/**
 * A deliberate, named, greppable foot-gun (design D5): lets a self-hoster
 * who deploys to Fly on purpose accept a writable public deployment instead
 * of being permanently blocked by their own platform.
 */
function allowWritesOnPublic(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env.ALLOW_WRITES_ON_PUBLIC === 'true';
}

function requireEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set — no default is provided`);
  return value;
}

/**
 * Opposite exact-string direction from `READ_ONLY_MODE` (design D8) on
 * purpose: each variable defaults to the SAFE value. A shared
 * truthy-coercion helper would make `COOKIE_SECURE=false` the only way to
 * disable it by accident sharing logic with a variable whose safe default
 * points the other way — kept as its own explicit check instead.
 */
function readCookieSecure(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env.COOKIE_SECURE !== 'false';
}

/**
 * Opposite exact-string direction from `COOKIE_SECURE` on purpose (design D8,
 * row 29) — but, unlike `COOKIE_SECURE`, `READ_ONLY_MODE` does NOT default
 * to the safe value. Only the exact string `'true'` enables read-only mode:
 * `'false'`/`'FALSE'`/`'0'`/`''`/unset all leave mutations allowed. That
 * omitted-variable case is exactly the gap `isPublicDeployment` /
 * `PublicDeploymentRequiresReadOnlyError` below exist to close for public
 * deployments (design D5, `#1975`) — self-hosted operators keep the
 * permissive default on purpose, since a writable dashboard is the product.
 * Kept as its own explicit check, like `readCookieSecure`, rather than a
 * shared truthy-coercion helper, so a typo in either direction fails loud.
 */
function readReadOnlyMode(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env.READ_ONLY_MODE === 'true';
}

/**
 * Reads the required env vars, throwing eagerly rather than deferring the
 * check to `start()` (unlike the server's lazy admin-key check): none of
 * these four variables gates an async migration, so there is no reason to
 * wait before failing. Also refuses to return a config at all when the
 * deployment looks public and would otherwise boot writable by omission
 * (design D5) — this keeps the failure at the same eager point rather than
 * introducing a new failure timing.
 */
export function readCompositionConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CompositionConfig {
  const readOnly = readReadOnlyMode(env);
  if (isPublicDeployment(env) && !readOnly && !allowWritesOnPublic(env)) {
    throw new PublicDeploymentRequiresReadOnlyError();
  }

  return {
    upstreamUrl: requireEnv(env, 'UPSTREAM_URL'),
    adminApiKey: requireEnv(env, 'ADMIN_API_KEY'),
    dashboardPassword: requireEnv(env, 'DASHBOARD_PASSWORD'),
    cookieSecure: readCookieSecure(env),
    readOnly,
    dashboardDistDir: requireEnv(env, 'DASHBOARD_DIST_DIR'),
  };
}
