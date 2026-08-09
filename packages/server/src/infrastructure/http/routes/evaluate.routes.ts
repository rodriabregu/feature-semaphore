import type { TargetingRule } from '@rodriab/feature-semaphore-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  previewEvaluation,
  type CandidateOverlay,
} from '../../../application/use-cases/preview-evaluation.js';
import type { FlagRepository } from '../../../application/ports/flag-repository.js';
import { previewBody } from '../schemas/evaluate.js';

export interface EvaluateRoutesDeps {
  readonly repo: FlagRepository;
}

/**
 * No `uow`, no `audit`, no `clock` — a pure read. Preview writes NO audit
 * row, matching `GET /flags`.
 */
export function registerEvaluateRoutes(app: FastifyInstance, deps: EvaluateRoutesDeps): void {
  app.post('/evaluate/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = previewBody.parse(request.body);

    const candidate: CandidateOverlay | undefined = body.candidate
      ? {
          enabled: body.candidate.enabled,
          onValue: body.candidate.on_value,
          offValue: body.candidate.off_value,
          rollout: body.candidate.rollout_percentage,
          rules: body.candidate.rules as readonly TargetingRule[] | undefined,
          overrides: body.candidate.overrides
            ? Object.fromEntries(body.candidate.overrides.map((o) => [o.unit_id, o.serve]))
            : undefined,
        }
      : undefined;

    const evaluation = await previewEvaluation(deps.repo, {
      ref: { flagKey: body.flag_key, environment: body.environment },
      context: {
        unitId: body.context.unit_id,
        attributes: body.context.attributes,
        defaultValue: body.context.default_value,
      },
      candidate,
    });

    reply.send({
      value: evaluation.value,
      reason: evaluation.reason,
      flag_key: body.flag_key,
      environment: body.environment,
      candidate_applied: body.candidate !== undefined,
    });
  });
}
