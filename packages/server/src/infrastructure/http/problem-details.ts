import type { DomainErrorCode } from '../../application/errors/domain-error.js';

const BASE = 'https://feature-semaphore.dev/problems';

/**
 * No `'forbidden_environment'` member. `'forbidden_kind'` is the phase's only
 * 403 — the management API is not environment-scoped by credential.
 */
export type ProblemCode =
  | DomainErrorCode
  | 'validation_failed'
  | 'missing_precondition'
  | 'malformed_precondition'
  | 'internal';

export interface ProblemSpec {
  readonly status: number;
  readonly title: string;
  readonly type: string;
}

/**
 * AUTHORITATIVE status/title/type table. Typed as `Record<ProblemCode, ProblemSpec>`
 * over a union derived from the error classes, so adding an error class without a
 * status is a compile error.
 */
export const PROBLEM_BY_CODE: Record<ProblemCode, ProblemSpec> = {
  validation_failed: { status: 400, title: 'Validation failed', type: `${BASE}/validation-failed` },
  malformed_precondition: {
    status: 400,
    title: 'Malformed If-Match',
    type: `${BASE}/malformed-precondition`,
  },
  unauthorized: { status: 401, title: 'Unauthorized', type: `${BASE}/unauthorized` },
  forbidden_kind: { status: 403, title: 'Forbidden key kind', type: `${BASE}/forbidden-kind` },
  not_found: { status: 404, title: 'Not found', type: `${BASE}/not-found` },
  duplicate_key: { status: 409, title: 'Flag key already exists', type: `${BASE}/duplicate-key` },
  version_conflict: { status: 412, title: 'Version conflict', type: `${BASE}/version-conflict` },
  missing_precondition: {
    status: 428,
    title: 'If-Match required',
    type: `${BASE}/missing-precondition`,
  },
  corrupt_row: { status: 500, title: 'Internal server error', type: `${BASE}/internal` },
  internal: { status: 500, title: 'Internal server error', type: `${BASE}/internal` },
};
