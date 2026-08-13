import type { Environment, FlagWire } from '../../api/types.js';

export interface LastModified {
  readonly at: string;
  readonly environment: Environment;
}

/**
 * `max(development.updated_at, production.updated_at)`, labelled with its
 * source environment. A bare timestamp would let a development tweak render
 * as production recency on the screen operators scan for production risk
 * (spec "Dev-only edit does not imply prod recency"). An exact tie favours
 * production `[I]` (design §16).
 */
export function lastModified(flag: FlagWire): LastModified {
  const developmentAt = flag.environments.development.updated_at;
  const productionAt = flag.environments.production.updated_at;

  if (new Date(productionAt).getTime() >= new Date(developmentAt).getTime()) {
    return { at: productionAt, environment: 'production' };
  }
  return { at: developmentAt, environment: 'development' };
}
