import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Clock } from '../../ports/clock.js';
import type { SessionStore } from '../../session/session-store.js';
import { sendBffProblem } from '../problem.js';

export const SESSION_COOKIE_NAME = 'fs_dash_sid';

export interface SessionGuardOptions {
  readonly sessions: SessionStore;
  readonly clock: Clock;
}

/**
 * `onRequest` hook rejecting any request without a live session BEFORE its
 * handler runs — the shape of `packages/server/src/infrastructure/http/plugins/auth.ts:32`.
 * This is what makes "upstream never called" true for every proxied route
 * once B3a/B3b register real ones inside the same scope.
 */
export function sessionGuardPlugin(app: FastifyInstance, options: SessionGuardOptions): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const record = sessionId ? options.sessions.find(sessionId, options.clock.now()) : undefined;

    if (!record) {
      await sendBffProblem(reply, 'unauthenticated', request.url);
    }
  });
}
