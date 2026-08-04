import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { replaceRules } from '../../../application/use-cases/replace-rules.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { configToWireVersion } from '../mappers/version.js';
import { parseIfMatch } from '../preconditions.js';
import { configParams, replaceRulesBody } from '../schemas/flags.js';

export interface RulesRoutesDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}

/** `PUT /flags/:key/config/:env/rules` — honors `If-Match` identically to `PATCH config`. */
export function registerRulesRoutes(app: FastifyInstance, deps: RulesRoutesDeps): void {
  app.put('/flags/:key/config/:env/rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = configParams.parse(request.params);
    const body = replaceRulesBody.parse(request.body);
    const expectedVersion = parseIfMatch(request.headers['if-match']);
    const actor = request.auth?.apiKeyId ?? 'unknown';

    const result = await replaceRules(deps.uow, deps.clock, {
      ref: { flagKey: params.key, environment: params.env },
      rules: body.rules,
      expectedVersion,
      actor,
    });

    reply.header('ETag', configToWireVersion(result.version)).send({ version: result.version });
  });
}
