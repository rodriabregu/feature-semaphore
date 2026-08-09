import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { listExposures, listFlagTotals } from '../../../application/use-cases/list-exposures.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { ExposureRepository } from '../../../application/ports/exposure-repository.js';
import { flagKeyParams } from '../schemas/flags.js';
import { makeExposuresQuery } from '../schemas/exposures.js';

export interface ExposuresRoutesDeps {
  readonly exposures: ExposureRepository;
  readonly clock: Clock;
}

/**
 * The bulk route is `/exposures`, a top-level SIBLING, never `/flags/exposures`
 * — a legal flag key could be literally `exposures`, and static routes always
 * beat parametric ones in Fastify, so that path would permanently shadow it.
 */
export function registerExposuresRoutes(app: FastifyInstance, deps: ExposuresRoutesDeps): void {
  const exposuresQuery = makeExposuresQuery(deps.clock);

  app.get('/flags/:key/exposures', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = flagKeyParams.parse(request.params);
    const query = exposuresQuery.parse(request.query);

    const result = await listExposures(deps.exposures, {
      flagKey: params.key,
      environment: query.env,
      since: query.since,
    });

    reply.send({
      flag_key: params.key,
      environment: query.env,
      since: result.since.toISOString(),
      total: result.total,
      breakdown: result.breakdown,
    });
  });

  app.get('/exposures', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = exposuresQuery.parse(request.query);

    const result = await listFlagTotals(deps.exposures, {
      environment: query.env,
      since: query.since,
    });

    reply.send({
      environment: query.env,
      since: result.since.toISOString(),
      flags: result.flags.map((f) => ({ flag_key: f.flagKey, total: f.total })),
    });
  });
}
