import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Environment } from '@rodriab/feature-semaphore-core';
import { ForbiddenKindError } from '../../../application/errors/domain-error.js';
import type { ApiKeyRepository } from '../../../application/ports/api-key-repository.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { AuthContext } from './auth.js';
import { authenticate, registerTouchHook } from './token-auth.js';

export interface SdkAuthContext {
  readonly apiKeyId: string;
  readonly environment: Environment; // NON-NULL — narrowed once, at the boundary
}

declare module 'fastify' {
  interface FastifyRequest {
    sdkAuth?: SdkAuthContext;
  }
}

export interface SdkAuthPluginOptions {
  readonly keys: ApiKeyRepository;
  readonly clock: Clock;
}

/**
 * An `onRequest` hook inside the `/api/v1/sdk` SIBLING scope (never nested
 * inside `/api/v1` — see `main/composition-root.ts`). Accepts only
 * `kind: 'server'` keys, the inverse of `authPlugin`'s `admin`-only rule.
 * `request.sdkAuth.environment` is the ONLY place an SDK route learns its
 * environment — never a path, query or body field.
 */
export function sdkAuthPlugin(app: FastifyInstance, options: SdkAuthPluginOptions): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const record = await authenticate(options.keys, reply, request.headers.authorization);

    if (record.kind !== 'server') {
      throw new ForbiddenKindError(record.kind, 'server');
    }
    if (record.environment === null) {
      // A malformed invariant (a `server` row with no environment) must never
      // be read as "some" environment. Falls through to the error handler's
      // unhandled branch -> 500, naming no environment.
      throw new Error('server-kind api key has no environment assigned');
    }

    const context: AuthContext = {
      apiKeyId: record.id,
      kind: record.kind,
      environment: record.environment,
    };
    request.auth = context;
    request.sdkAuth = { apiKeyId: record.id, environment: record.environment };
  });

  registerTouchHook(app, options.keys, options.clock);
}
