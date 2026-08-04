import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { archiveFlag } from '../../../application/use-cases/archive-flag.js';
import { createFlag } from '../../../application/use-cases/create-flag.js';
import { getFlag } from '../../../application/use-cases/get-flag.js';
import { listAudit } from '../../../application/use-cases/list-audit.js';
import { listFlags } from '../../../application/use-cases/list-flags.js';
import type { AuditLog } from '../../../application/ports/audit-log.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { FlagRepository } from '../../../application/ports/flag-repository.js';
import type { UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { flagToWire } from '../mappers/flag-response.js';
import { configToWireVersion } from '../mappers/version.js';
import { auditQuery, createFlagBody, flagKeyParams } from '../schemas/flags.js';

export interface FlagsRoutesDeps {
  readonly uow: UnitOfWork;
  readonly repo: FlagRepository;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export function registerFlagsRoutes(app: FastifyInstance, deps: FlagsRoutesDeps): void {
  app.get('/flags', async (_request: FastifyRequest, reply: FastifyReply) => {
    const flags = await listFlags(deps.repo);
    reply.send({ flags: flags.map(flagToWire) });
  });

  app.post('/flags', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createFlagBody.parse(request.body);
    const actor = request.auth?.apiKeyId ?? 'unknown';

    const created = await createFlag(deps.uow, deps.clock, {
      input: { key: body.key, name: body.name, description: body.description },
      actor,
    });

    // Both environments start at version 1 right after creation — a single
    // nominal ETag is honest here because the two counters are still in sync.
    reply
      .code(201)
      .header('Location', `/api/v1/flags/${created.flag.key}`)
      .header('ETag', configToWireVersion(1))
      .send(flagToWire(created));
  });

  app.get('/flags/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = flagKeyParams.parse(request.params);
    const flag = await getFlag(deps.repo, params.key);
    reply.send(flagToWire(flag));
  });

  app.post('/flags/:key/archive', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = flagKeyParams.parse(request.params);
    const actor = request.auth?.apiKeyId ?? 'unknown';

    await archiveFlag(deps.uow, deps.clock, { key: params.key, actor });
    reply.code(204).send();
  });

  app.get('/flags/:key/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = flagKeyParams.parse(request.params);
    const query = auditQuery.parse(request.query);
    const entries = await listAudit(deps.audit, params.key, query.limit);
    reply.send({ entries });
  });
}
