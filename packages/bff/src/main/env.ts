/**
 * The BFF's required, fail-fast environment. None of these three has a
 * default: a BFF with no password is a BFF with no door, a missing
 * `UPSTREAM_URL` must never silently fall back to localhost (that is how a
 * demo writes to production), and a missing `ADMIN_API_KEY` leaves nothing
 * to authenticate proxied requests with.
 */
export interface CompositionConfig {
  readonly upstreamUrl: string;
  readonly adminApiKey: string;
  readonly dashboardPassword: string;
  readonly cookieSecure: boolean;
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
 * Reads the required env vars, throwing eagerly rather than deferring the
 * check to `start()` (unlike the server's lazy admin-key check): none of
 * these three variables gates an async migration, so there is no reason to
 * wait before failing.
 */
export function readCompositionConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CompositionConfig {
  return {
    upstreamUrl: requireEnv(env, 'UPSTREAM_URL'),
    adminApiKey: requireEnv(env, 'ADMIN_API_KEY'),
    dashboardPassword: requireEnv(env, 'DASHBOARD_PASSWORD'),
    cookieSecure: readCookieSecure(env),
  };
}
