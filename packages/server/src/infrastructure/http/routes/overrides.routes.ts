import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { replaceOverrides } from '../../../application/use-cases/replace-overrides.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { configToWireVersion } from '../mappers/version.js';
import { parseIfMatch } from '../preconditions.js';
import { configParams, replaceOverridesBody } from '../schemas/flags.js';

export interface OverridesRoutesDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}

/** `PUT /flags/:key/config/:env/overrides` — same `If-Match` contract. */
export function registerOverridesRoutes(app: FastifyInstance, deps: OverridesRoutesDeps): void {
  app.put(
    '/flags/:key/config/:env/overrides',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = configParams.parse(request.params);
      const body = replaceOverridesBody.parse(request.body);
      const expectedVersion = parseIfMatch(request.headers['if-match']);
      const actor = request.auth?.apiKeyId ?? 'unknown';

      const result = await replaceOverrides(deps.uow, deps.clock, {
        ref: { flagKey: params.key, environment: params.env },
        overrides: body.overrides.map((o) => ({ unitId: o.unit_id, serve: o.serve })),
        expectedVersion,
        actor,
      });

      reply.header('ETag', configToWireVersion(result.version)).send({ version: result.version });
    },
  );
}
