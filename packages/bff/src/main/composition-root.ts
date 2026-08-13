import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { CompositionConfig } from './env.js';
import { createSystemClock } from '../system-clock.js';
import { createTimersDelay } from '../timers-delay.js';
import { createLoginThrottle } from '../http/plugins/login-throttle.js';
import { registerSessionRoutes } from '../http/routes/session.routes.js';
import { createMemorySessionStore } from '../session/session-store.js';

export type { CompositionConfig } from './env.js';

export interface Composition {
  readonly app: FastifyInstance;
  /**
   * Flips `/readyz` from 503 to 200. Kept as an explicit, caller-controlled
   * step — mirroring `packages/server/src/main/composition-root.ts` — so the
   * pre-ready window is observable rather than a timing race, even though
   * the BFF has no migration to await yet.
   */
  readonly start: () => Promise<void>;
}

/**
 * Wires the session/login slice: the memory session store, the injectable
 * `Delay`-backed login throttle, and `@fastify/cookie` with signing
 * disabled (the token is opaque and the store is authoritative, so a
 * signature would guard nothing). The proxy scope (B3a+) will register its
 * own guarded routes alongside `sessionGuardPlugin`.
 */
export async function buildApp(config: CompositionConfig): Promise<Composition> {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);

  const clock = createSystemClock();
  const sessions = createMemorySessionStore();
  const delay = createTimersDelay();
  const throttle = createLoginThrottle(delay);

  registerSessionRoutes(app, { config, sessions, clock, throttle });

  let isReady = false;
  app.get('/healthz', (_request, reply: FastifyReply) => {
    reply.send({ status: 'ok' });
  });
  app.get('/readyz', (_request, reply: FastifyReply) => {
    if (!isReady) {
      reply.code(503).send({ status: 'not-ready' });
      return;
    }
    reply.send({ status: 'ready' });
  });

  const start = (): Promise<void> => {
    isReady = true;
    return Promise.resolve();
  };

  return { app, start };
}
