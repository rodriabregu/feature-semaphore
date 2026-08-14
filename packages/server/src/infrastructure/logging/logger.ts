import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LoggerOptions } from 'pino';

/**
 * Structured logging config for the server process.
 *
 * Fastify's `logger` option consumes a pino OPTIONS object, not a live
 * `pino()` instance — passing an already-built instance via `logger:` throws
 * `FST_ERR_LOG_INVALID_LOGGER_CONFIG` under Fastify v5 (a real instance goes
 * through the separate `loggerInstance:` option instead). This factory
 * therefore returns options; Fastify builds the real logger internally
 * (`pino(opts, opts.stream)`), which is also why `stream` is accepted here
 * as a plain override rather than a second constructor argument.
 *
 * Redacts credentials and session tokens. The `req`/`res` serializers below
 * intentionally surface only method/url/headers and statusCode/headers —
 * request and response BODIES are never included in either serializer, so no
 * user attribute (e.g. the `POST /api/v1/evaluate/preview` payload) can leak
 * through logging, structurally rather than via the redact list below.
 *
 * Mirrored in `packages/bff/src/main/logger.ts` — keep the redact list and
 * serializer shape identical in both files; a change to one is a change to
 * both (design Part 2 §8: duplication here is deliberate, not an oversight).
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
] as const;

export interface ServerLoggerOverrides {
  /** Test seam only — production never overrides pino's default stdout stream. */
  readonly stream?: { write(msg: string): boolean };
}

export function createServerLogger(
  overrides: ServerLoggerOverrides = {},
): LoggerOptions & ServerLoggerOverrides {
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
