import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LoggerOptions } from 'pino';

/**
 * Structured logging config for the BFF process.
 *
 * Deliberate duplication of
 * `packages/server/src/infrastructure/logging/logger.ts` (design Part 2 §8)
 * — the alternative is a new shared workspace package for two ~20-line
 * files, which is the more expensive answer here. Keep the redact list and
 * serializer shape identical in both files; a change to one is a change to
 * both.
 *
 * Same Fastify v5 constraint as the server copy: `logger:` takes pino
 * OPTIONS, never a pre-built instance (`loggerInstance:` is for that).
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
] as const;

export interface BffLoggerOverrides {
  /** Test seam only — production never overrides pino's default stdout stream. */
  readonly stream?: { write(msg: string): boolean };
}

export function createBffLogger(
  overrides: BffLoggerOverrides = {},
): LoggerOptions & BffLoggerOverrides {
  return {
    level: 'info',
    redact: [...REDACT_PATHS],
    serializers: {
      req: (request: FastifyRequest) => ({
        method: request.method,
        url: request.url,
        headers: request.headers,
      }),
      res: (reply: FastifyReply) => ({
        statusCode: reply.statusCode,
        headers: reply.getHeaders(),
      }),
    },
    ...overrides,
  };
}
