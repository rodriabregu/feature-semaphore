import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Environment } from '@rodriab/feature-semaphore-core';
import { ForbiddenKindError } from '../../../application/errors/domain-error.js';
import type { ApiKeyRepository } from '../../../application/ports/api-key-repository.js';
import type { Clock } from '../../../application/ports/clock.js';
import { authenticate, registerTouchHook } from './token-auth.js';

export interface AuthContext {
  readonly apiKeyId: string;
  readonly kind: 'admin' | 'server';
  readonly environment: Environment | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export interface AuthPluginOptions {
  readonly keys: ApiKeyRepository;
  readonly clock: Clock;
}

/**
 * An `onRequest` hook inside the `/api/v1` scope, so health routes are outside
 * it by construction rather than by an exemption list. Kind enforcement
 * (`admin` required) is the phase's only 403 — no environment check: the
 * management API is not environment-scoped by credential.
 */
export function authPlugin(app: FastifyInstance, options: AuthPluginOptions): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const record = await authenticate(options.keys, reply, request.headers.authorization);

    if (record.kind !== 'admin') {
      throw new ForbiddenKindError(record.kind, 'admin');
    }

    request.auth = { apiKeyId: record.id, kind: record.kind, environment: record.environment };
  });

  registerTouchHook(app, options.keys, options.clock);
}
