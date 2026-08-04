import type { FlagRepository, FlagWithAllEnvironments } from '../ports/flag-repository.js';

/** Read-only, both environments per flag, no credential scoping. */
export function listFlags(repo: FlagRepository): Promise<readonly FlagWithAllEnvironments[]> {
  return repo.listAllEnvironments();
}
