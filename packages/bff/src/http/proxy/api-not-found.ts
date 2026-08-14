import type { FastifyInstance } from 'fastify';
import { sendBffProblem } from '../problem.js';

/**
 * Scoped 404 for the `/api` prefix (design D1). Registered on the same
 * instance `registerProxyRoutes` receives, so both production (`buildApp`)
 * and the fidelity harness (`http/__tests__/test-bff.ts`) get it for free —
 * neither file needs to remember to call this, because `registerProxyRoutes`
 * is the one module both already call.
 *
 * Without this, an unregistered `/api/*` path falls through to Fastify's
 * default not-found handler, which returns plain JSON — not the
 * `application/problem+json` shape every other BFF error uses.
 */
export function registerApiNotFound(instance: FastifyInstance): void {
  instance.setNotFoundHandler((request, reply) => sendBffProblem(reply, 'not_found', request.url));
}
