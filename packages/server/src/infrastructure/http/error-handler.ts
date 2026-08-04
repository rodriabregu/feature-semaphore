import { ZodError } from 'zod';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../../application/errors/domain-error.js';
import { MalformedPreconditionError, MissingPreconditionError } from './preconditions.js';
import { PROBLEM_BY_CODE, type ProblemCode } from './problem-details.js';

interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly errors?: readonly { path: string; code: string }[];
  readonly expectedVersion?: number;
  readonly actualVersion?: number;
  readonly key?: string;
}

function send(
  reply: FastifyReply,
  code: ProblemCode,
  instance: string,
  extra: Partial<ProblemBody> = {},
): void {
  const spec = PROBLEM_BY_CODE[code];
  const body: ProblemBody = {
    type: spec.type,
    title: spec.title,
    status: spec.status,
    detail: spec.title,
    instance,
    ...extra,
  };
  reply.code(spec.status).type('application/problem+json').send(body);
}

/**
 * Three branches, in order: (1) Zod/validation errors; (2) domain errors and
 * precondition errors, mapped through the AUTHORITATIVE `PROBLEM_BY_CODE`
 * table; (3) everything else — no message, no stack to the client, the full
 * error logged with the request id.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
      const zodError = extractZodError(error);
      if (zodError) {
        send(reply, 'validation_failed', request.url, {
          errors: zodError.issues.map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code,
          })),
        });
        return;
      }

      if (error instanceof MissingPreconditionError) {
        send(reply, 'missing_precondition', request.url);
        return;
      }
      if (error instanceof MalformedPreconditionError) {
        send(reply, 'malformed_precondition', request.url);
        return;
      }

      if (error instanceof DomainError) {
        const extra: Partial<ProblemBody> =
          error.code === 'version_conflict' && 'expected' in error && 'actual' in error
            ? { expectedVersion: error.expected as number, actualVersion: error.actual as number }
            : error.code === 'duplicate_key' && 'key' in error
              ? { key: error.key as string }
              : {};
        send(reply, error.code, request.url, extra);
        return;
      }

      request.log.error({ err: error, reqId: request.id }, 'unhandled error');
      send(reply, 'internal', request.url);
    },
  );
}

/**
 * Route handlers call `schema.parse(...)` directly (no Fastify
 * `setValidatorCompiler`), so a validation failure always arrives here as a
 * genuine `ZodError`, thrown or wrapped one level by an intermediate `catch`.
 */
function extractZodError(error: unknown): ZodError | undefined {
  if (error instanceof ZodError) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    (error as { cause?: unknown }).cause instanceof ZodError
  ) {
    return (error as { cause: ZodError }).cause;
  }
  return undefined;
}
