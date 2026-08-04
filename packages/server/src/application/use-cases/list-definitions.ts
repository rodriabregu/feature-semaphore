import type { Environment, FlagDefinition } from '@rodriab/feature-semaphore-core';
import type { FlagRepository } from '../ports/flag-repository.js';

/**
 * Read-only, environment scoped by ARGUMENT, never by credential. Archived
 * flags are returned marked `archived: true`, never filtered — the adapter
 * already enforces this; this use case is a thin pass-through on purpose.
 */
export function listDefinitions(
  repo: FlagRepository,
  env: Environment,
): Promise<readonly FlagDefinition[]> {
  return repo.listDefinitions(env);
}
