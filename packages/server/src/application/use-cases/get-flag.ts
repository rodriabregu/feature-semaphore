import { NotFoundError } from '../errors/domain-error.js';
import type { FlagRepository, FlagWithAllEnvironments } from '../ports/flag-repository.js';

/** Read-only, both environments. @throws NotFoundError */
export async function getFlag(repo: FlagRepository, key: string): Promise<FlagWithAllEnvironments> {
  const found = await repo.findAllEnvironmentsByKey(key);
  if (!found) throw new NotFoundError('flag', key);
  return found;
}
