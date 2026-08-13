import type { FastifyInstance } from 'fastify';
import type { CompositionConfig } from '../../main/env.js';
import type { Clock } from '../../ports/clock.js';
import { SESSION_TTL_MS, type SessionStore } from '../../session/session-store.js';
import { comparePassword } from '../../session/password.js';
import type { LoginThrottle } from '../plugins/login-throttle.js';
import { sendBffProblem } from '../problem.js';

export const SESSION_COOKIE_NAME = 'fs_dash_sid';

/** `[I]` The only unauthenticated route; Fastify's 1 MiB default is 1000x what a password needs. */
const LOGIN_BODY_LIMIT_BYTES = 1024;

export interface SessionRoutesOptions {
  readonly config: CompositionConfig;
  readonly sessions: SessionStore;
  readonly clock: Clock;
  readonly throttle: LoginThrottle;
}

interface LoginBody {
  readonly password?: unknown;
}

/**
 * `POST /login` / `POST /logout` — spec-pinned paths (`#1894` X1), not the
 * rev-1-invented `POST`/`DELETE /session`.
 */
export function registerSessionRoutes(app: FastifyInstance, options: SessionRoutesOptions): void {
  app.post<{ Body: LoginBody }>(
    '/login',
    { bodyLimit: LOGIN_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const submitted = typeof request.body.password === 'string' ? request.body.password : '';

      const succeeded = await options.throttle.attempt(() =>
        comparePassword(submitted, options.config.dashboardPassword),
      );

      if (!succeeded) {
        await sendBffProblem(reply, 'invalid_credentials', request.url);
        return;
      }

      const now = options.clock.now();
      const record = options.sessions.create(now);
      await reply
        .setCookie(SESSION_COOKIE_NAME, record.id, {
          httpOnly: true,
          secure: options.config.cookieSecure,
          sameSite: 'strict',
          path: '/',
          maxAge: Math.floor(SESSION_TTL_MS / 1000),
        })
        .code(200)
        .send({ status: 'ok' });
    },
  );

  app.post('/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (sessionId) {
      options.sessions.revoke(sessionId);
    }
    await reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' }).code(204).send();
  });
}
