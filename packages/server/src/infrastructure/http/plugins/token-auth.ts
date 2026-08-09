import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../../../application/errors/domain-error.js';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
} from '../../../application/ports/api-key-repository.js';
import type { Clock } from '../../../application/ports/clock.js';

export const TOKEN_SHAPE = /^fs_(admin|server)_[A-Za-z0-9_-]{43}$/;
export const TOUCH_THROTTLE_MS = 60_000;

export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function unauthorized(reply: FastifyReply): UnauthorizedError {
  reply.header('WWW-Authenticate', 'Bearer');
  return new UnauthorizedError();
}

/**
 * Parses, shape-checks, hashes and looks up. Shared by both the management and
 * SDK auth plugins — the `kind` check that follows is deliberately NOT part of
 * this function, so it cannot be shared by accident.
 * @throws UnauthorizedError (sets `WWW-Authenticate` on `reply` first).
 */
export async function authenticate(
  keys: ApiKeyRepository,
  reply: FastifyReply,
  header: string | undefined,
): Promise<ApiKeyRecord> {
  const token = parseBearer(header);
  if (!token || !TOKEN_SHAPE.test(token)) {
    throw unauthorized(reply);
  }

  const record = await keys.findByHash(hashToken(token));
  if (!record) {
    throw unauthorized(reply);
  }

  return record;
}

/**
 * The throttled `onResponse` touch hook, verbatim from Phase 2. Reads
 * `request.auth`, which both `authPlugin` and `sdkAuthPlugin` set — so this
 * function needs no parameterisation by scope.
 */
export function registerTouchHook(
  app: FastifyInstance,
  keys: ApiKeyRepository,
  clock: Clock,
): void {
  const lastTouch = new Map<string, number>();

  app.addHook('onResponse', async (request) => {
    if (!request.auth) return;
    const now = clock.now();
    const last = lastTouch.get(request.auth.apiKeyId);
    if (last !== undefined && now.getTime() - last < TOUCH_THROTTLE_MS) return;

    lastTouch.set(request.auth.apiKeyId, now.getTime());
    try {
      const staleBefore = new Date(now.getTime() - TOUCH_THROTTLE_MS);
      await keys.touch(request.auth.apiKeyId, now, staleBefore);
    } catch {
      // An observability write must never fail a request that already succeeded.
    }
  });
}
