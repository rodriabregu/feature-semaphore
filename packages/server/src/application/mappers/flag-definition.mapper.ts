import type { FlagDefinition } from '@rodriab/feature-semaphore-core';
import type { FlagAggregate } from '../ports/flag-repository.js';
import { decodeRule } from './row-decoders.js';

/**
 * @precondition `aggregate.rules` is ALREADY ordered by `position` ASC. This
 * function does not sort and contains no comparator. Ordering is the ADAPTER's
 * guarantee (SQL `ORDER BY position ASC`), because core treats rule order as a
 * precondition it does not verify.
 * @throws CorruptRowError when a persisted rule does not decode to core's union.
 */
export function toFlagDefinition(aggregate: FlagAggregate): FlagDefinition {
  return {
    key: aggregate.flag.key,
    environment: aggregate.config.environment,
    archived: aggregate.flag.archivedAt !== null,
    enabled: aggregate.config.enabled,
    onValue: aggregate.config.onValue,
    offValue: aggregate.config.offValue,
    rollout: aggregate.config.rolloutPercentage,
    salt: aggregate.config.salt,
    rules: aggregate.rules.map((rule) => decodeRule(rule)), // index-preserving, never reordering
    overrides: Object.fromEntries(aggregate.overrides.map((o) => [o.unitId, o.serve])),
  };
}
