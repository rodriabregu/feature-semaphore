import type { FastifyReply } from 'fastify';

const BFF_BASE = 'https://feature-semaphore.dev/problems/bff';
// Distinct namespace from packages/server/src/infrastructure/http/problem-details.ts:3 —
// lets a client tell "the BFF refused" from "the server refused".

export type BffProblemCode =
  | 'unauthenticated'
  | 'read_only'
  | 'invalid_credentials'
  | 'upstream_unavailable'
  | 'not_found';

export interface BffProblemSpec {
  readonly status: number;
  readonly title: string;
  readonly type: string;
}

/**
 * FIVE codes. `too_many_attempts` is deliberately absent (design C6): a
 * wrong password is a plain 401, only slower. Nothing was reverted —
 * `PROBLEM_BY_CODE` holds ten codes and none is `too_many_attempts`
 * (packages/server/src/infrastructure/http/problem-details.ts:27-46), and
 * this table is a new file, so the code is simply never added. Row 12 guards
 * it. `not_found` was added in Phase 5 (design D1) so an unregistered
 * `/api/*` path returns the same problem+json shape as every other BFF
 * error, instead of Fastify's default JSON 404 — required once
 * `registerApiNotFound` gives the scoped not-found handler a body to send.
 */
export const BFF_PROBLEM_BY_CODE: Record<BffProblemCode, BffProblemSpec> = {
  unauthenticated: { status: 401, title: 'Not signed in', type: `${BFF_BASE}/unauthenticated` },
  read_only: { status: 403, title: 'Read-only mode', type: `${BFF_BASE}/read-only` },
  invalid_credentials: {
    status: 401,
    title: 'Invalid credentials',
    type: `${BFF_BASE}/invalid-credentials`,
  },
  upstream_unavailable: {
    status: 502,
    title: 'Upstream unavailable',
    type: `${BFF_BASE}/upstream-unavailable`,
  },
  not_found: { status: 404, title: 'Not found', type: `${BFF_BASE}/not-found` },
};

export async function sendBffProblem(
  reply: FastifyReply,
  code: BffProblemCode,
  instance: string,
): Promise<void> {
  const spec = BFF_PROBLEM_BY_CODE[code];
  await reply.code(spec.status).type('application/problem+json').send({
    type: spec.type,
    title: spec.title,
    status: spec.status,
    detail: spec.title,
    instance,
  });
}
