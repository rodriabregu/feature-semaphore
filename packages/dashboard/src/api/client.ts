const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * Mirrors the server's `problem+json` body (`packages/server/.../error-handler.ts`)
 * plus the two optional version fields a 412 carries (`.../error-handler.ts:13-17`).
 * The BFF forwards this shape byte-for-byte (design Part 1 §4), so it is the
 * same shape on both sides of the proxy.
 */
export interface ApiProblem {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly expectedVersion?: number;
  readonly actualVersion?: number;
}

/** A failed `apiFetch` call always throws this — never `undefined` (row 47). */
export class ApiError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

/**
 * A 401 from a proxied call specifically — distinguishable from a generic
 * `ApiError` via `instanceof` (design §10.8, spec "Session expiry surfaces
 * clearly"), so a caller can show "sign in again" rather than a generic
 * failure message.
 */
export class SessionExpiredError extends ApiError {
  constructor(problem: ApiProblem) {
    super(problem);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Fired exactly once per 401 that is not explicitly suppressed (row 48) — the
 * app shell subscribes once and flips into "session expired, sign in again"
 * (spec: "Session expiry surfaces clearly, draft loss accepted").
 */
export const SESSION_EXPIRED_EVENT = 'session-expired';
export const sessionEvents = new EventTarget();

export interface ApiFetchOptions extends RequestInit {
  /** Injectable for tests; defaults to the real global `fetch`. */
  readonly fetchFn?: typeof fetch;
  /**
   * `POST /login`'s 401 means "wrong password", never "your session died" —
   * it happens before any session exists. Every OTHER call reaches a
   * proxied route sitting behind the BFF's session guard, where a 401 can
   * only mean the session is gone (design Part 1 §3). Defaults to `false`.
   */
  readonly suppressSessionExpiry?: boolean;
}

async function toProblem(response: Response): Promise<ApiProblem> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes(PROBLEM_CONTENT_TYPE)) {
    const body = (await response.json()) as Partial<ApiProblem>;
    return {
      status: response.status,
      type: body.type ?? 'about:blank',
      title: body.title ?? (response.statusText || 'Request failed'),
      detail: body.detail ?? '',
      expectedVersion: body.expectedVersion,
      actualVersion: body.actualVersion,
    };
  }
  return {
    status: response.status,
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    detail: '',
  };
}

/**
 * The ONLY module naming `fetch` in the dashboard (mirrors
 * `packages/sdk-node/src/http-transport.ts:18-25`). Parses a `problem+json`
 * failure into a typed `ApiProblem` and, for any unsuppressed 401, dispatches
 * `SESSION_EXPIRED_EVENT` and throws the more specific `SessionExpiredError`
 * so a caller can tell "your session died" from any other failure.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { fetchFn = fetch, suppressSessionExpiry = false, ...init } = options;
  const response = await fetchFn(path, init);

  if (!response.ok) {
    const problem = await toProblem(response);
    if (response.status === 401 && !suppressSessionExpiry) {
      sessionEvents.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      throw new SessionExpiredError(problem);
    }
    throw new ApiError(problem);
  }

  // POST /logout responds 204 with no body (design Part 2 §10.6).
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
