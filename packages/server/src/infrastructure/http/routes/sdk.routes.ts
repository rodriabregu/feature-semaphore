import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { listDefinitions } from '../../../application/use-cases/list-definitions.js';
import type { FlagRepository } from '../../../application/ports/flag-repository.js';
import { canonicalString, definitionsEtag, sortDefinitions } from '../etag/definitions-etag.js';
import { parseIfNoneMatch } from '../preconditions.js';
import type { SdkAuthContext } from '../plugins/sdk-auth.js';
import type { SdkDefinitionsResponse } from '../schemas/sdk.js';

export interface SdkRoutesDeps {
  readonly repo: FlagRepository;
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
  app.get('/definitions', async (request: FastifyRequest, reply: FastifyReply) => {
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
  });
}
