import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { listDefinitions } from '../../../application/use-cases/list-definitions.js';
import { recordExposures } from '../../../application/use-cases/record-exposures.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { ExposureRepository } from '../../../application/ports/exposure-repository.js';
import type { FlagRepository } from '../../../application/ports/flag-repository.js';
import { canonicalString, definitionsEtag, sortDefinitions } from '../etag/definitions-etag.js';
import { parseIfNoneMatch } from '../preconditions.js';
import type { Histogram } from '../metrics/histogram.js';
import type { SdkAuthContext } from '../plugins/sdk-auth.js';
import { eventsBody, type SdkDefinitionsResponse } from '../schemas/sdk.js';

export interface SdkRoutesDeps {
  readonly repo: FlagRepository;
  readonly exposures: ExposureRepository;
  readonly clock: Clock;
  readonly histogram: Histogram;
}

/**
 * `request.sdkAuth` is set by `sdkAuthPlugin`'s `onRequest` hook, which runs
 * for every route in this scope before any handler — a missing value here
 * means the route was reached outside that scope, a wiring defect that must
 * fail loudly (500), never silently default to some environment.
 */
function requireSdkAuth(request: FastifyRequest): SdkAuthContext {
  if (!request.sdkAuth) {
    throw new Error('SDK route reached without sdkAuthPlugin having run');
  }
  return request.sdkAuth;
}

export function registerSdkRoutes(app: FastifyInstance, deps: SdkRoutesDeps): void {
  app.get(
    '/definitions',
    {
      // Route-scoped, not `app.addHook` on the whole scope — this hook must
      // feed the latency histogram for `/definitions` only, never `/events`.
      onResponse: async (_request: FastifyRequest, reply: FastifyReply) => {
        deps.histogram.observe(reply.elapsedTime / 1000);
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { environment } = requireSdkAuth(request);
      const definitions = await listDefinitions(deps.repo, environment);
      const sorted = sortDefinitions(definitions);
      const etag = definitionsEtag(canonicalString(sorted, environment));
      const etagValue = etag.slice(1, -1); // unquoted, to compare against parseIfNoneMatch's output

      reply
        .header('Cache-Control', 'private, no-cache')
        .header('Vary', 'Authorization')
        .header('ETag', etag);

      const ifNoneMatch = parseIfNoneMatch(request.headers['if-none-match']);
      if (ifNoneMatch.includes('*') || ifNoneMatch.includes(etagValue)) {
        reply.code(304).send();
        return;
      }

      const body: SdkDefinitionsResponse = { environment, definitions: sorted };
      reply.send(body);
    },
  );

  /**
   * Fire-and-forget from the caller's perspective: ALWAYS 202, even when
   * persistence rejects. Validation failure (`.strict()`, bounds) is a 400 —
   * it means the SDK's own serialiser is broken, the one signal it can act
   * on. A persistence failure is the server's problem; turning it into a 5xx
   * would invite retry storms from every SDK in the fleet over a usage
   * signal, not a transaction. The try/catch deliberately bypasses
   * `setErrorHandler`.
   */
  app.post('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const { environment } = requireSdkAuth(request);
    const parsed = eventsBody.parse(request.body);

    try {
      await recordExposures(deps.exposures, deps.clock, environment, parsed.exposures);
    } catch (error) {
      request.log.error({ err: error, reqId: request.id }, 'exposure persistence failed');
    }

    reply.code(202).send();
  });
}
