import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Environment } from '@rodriab/feature-semaphore-core';
import { ForbiddenKindError, UnauthorizedError } from '../../../application/errors/domain-error.js';
import type { ApiKeyRepository } from '../../../application/ports/api-key-repository.js';
import type { Clock } from '../../../application/ports/clock.js';

const TOKEN_SHAPE = /^fs_(admin|server)_[A-Za-z0-9_-]{43}$/;
const TOUCH_THROTTLE_MS = 60_000;

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
  const lastTouch = new Map<string, number>();

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = parseBearer(header);
    if (!token || !TOKEN_SHAPE.test(token)) {
      throw unauthorized(reply);
    }

    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    const record = await options.keys.findByHash(hash);
    if (!record) {
      throw unauthorized(reply);
    }

    if (record.kind !== 'admin') {
      throw new ForbiddenKindError(record.kind, 'admin');
    }

    request.auth = { apiKeyId: record.id, kind: record.kind, environment: record.environment };
  });

  app.addHook('onResponse', async (request: FastifyRequest) => {
    if (!request.auth) return;
    const now = options.clock.now();
    const last = lastTouch.get(request.auth.apiKeyId);
    if (last !== undefined && now.getTime() - last < TOUCH_THROTTLE_MS) return;

    lastTouch.set(request.auth.apiKeyId, now.getTime());
    try {
      const staleBefore = new Date(now.getTime() - TOUCH_THROTTLE_MS);
      await options.keys.touch(request.auth.apiKeyId, now, staleBefore);
    } catch {
      // An observability write must never fail a request that already succeeded.
    }
  });
}

function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

function unauthorized(reply: FastifyReply): UnauthorizedError {
  reply.header('WWW-Authenticate', 'Bearer');
  return new UnauthorizedError();
}
