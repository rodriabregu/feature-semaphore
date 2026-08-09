import { evaluate } from '@rodriab/feature-semaphore-core';
import type {
  Evaluation,
  EvalContext,
  FlagDefinition,
  TargetingRule,
} from '@rodriab/feature-semaphore-core';
import { NotFoundError } from '../errors/domain-error.js';
import { toFlagDefinition } from '../mappers/flag-definition.mapper.js';
import type { ConfigRef, FlagRepository } from '../ports/flag-repository.js';

export interface CandidateOverlay {
  readonly enabled?: boolean;
  readonly onValue?: boolean;
  readonly offValue?: boolean;
  readonly rollout?: number;
  readonly rules?: readonly TargetingRule[];
  readonly overrides?: Readonly<Record<string, boolean>>;
}

export interface PreviewQuery {
  readonly ref: ConfigRef;
  readonly context: EvalContext;
  readonly candidate?: CandidateOverlay;
}

/**
 * NEVER `{ ...saved, ...c }`. Every field is copied BY NAME over a `...saved`
 * base, so `salt`, `key`, `environment` and `archived` are structurally
 * uncopyable from the request even if the schema regressed. Returns a NEW
 * object; `saved` is never mutated.
 */
function overlay(saved: FlagDefinition, c: CandidateOverlay | undefined): FlagDefinition {
  if (!c) return saved;
  return {
    ...saved,
    enabled: c.enabled ?? saved.enabled,
    onValue: c.onValue ?? saved.onValue,
    offValue: c.offValue ?? saved.offValue,
    rollout: c.rollout ?? saved.rollout,
    rules: c.rules ?? saved.rules,
    overrides: c.overrides ?? saved.overrides,
  };
}

/** @throws NotFoundError — no saved config means no `salt`, so no honest bucket. */
export async function previewEvaluation(
  repo: FlagRepository,
  query: PreviewQuery,
): Promise<Evaluation> {
  const aggregate = await repo.findByKey(query.ref);
  if (!aggregate) throw new NotFoundError('flag', query.ref.flagKey);
  const saved = toFlagDefinition(aggregate); // the SAME mapper /sdk/definitions uses
  return evaluate(overlay(saved, query.candidate), query.context);
}
