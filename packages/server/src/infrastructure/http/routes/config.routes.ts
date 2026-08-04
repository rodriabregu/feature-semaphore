import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { updateConfig } from '../../../application/use-cases/update-config.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { configToWireVersion } from '../mappers/version.js';
import { parseIfMatch } from '../preconditions.js';
import { configParams, updateConfigBody } from '../schemas/flags.js';

export interface ConfigRoutesDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}

/** `PATCH /flags/:key/config/:env` — requires `If-Match`. 428/400/412 per the precedence chain. */
export function registerConfigRoutes(app: FastifyInstance, deps: ConfigRoutesDeps): void {
  app.patch('/flags/:key/config/:env', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = configParams.parse(request.params);
    const body = updateConfigBody.parse(request.body);
    const expectedVersion = parseIfMatch(request.headers['if-match']);
    const actor = request.auth?.apiKeyId ?? 'unknown';

    const result = await updateConfig(deps.uow, deps.clock, {
      ref: { flagKey: params.key, environment: params.env },
      patch: {
        enabled: body.enabled,
        offValue: body.off_value,
        onValue: body.on_value,
        rolloutPercentage: body.rollout_percentage,
      },
      expectedVersion,
      actor,
    });

    reply.header('ETag', configToWireVersion(result.version)).send({ version: result.version });
  });
}
