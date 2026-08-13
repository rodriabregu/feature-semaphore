import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { CompositionConfig } from './env.js';

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
 * `config` is accepted now, ahead of any consumer, so every later slice
 * (session, proxy) wires into one stable signature rather than widening it
 * per slice.
 */
export function buildApp(config: CompositionConfig): Promise<Composition> {
  void config;

  const app = Fastify({ logger: false });

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

  // Not `async` — nothing here awaits yet. Kept Promise-returning so later
  // slices (session, proxy) can add real awaits without widening the signature.
  const start = (): Promise<void> => {
    isReady = true;
    return Promise.resolve();
  };

  return Promise.resolve({ app, start });
}
