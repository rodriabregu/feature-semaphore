import type {
  FlagConfig,
  FlagWithAllEnvironments,
  PersistedOverride,
  PersistedRule,
} from '../../../application/ports/flag-repository.js';

function ruleToWire(rule: PersistedRule): Record<string, unknown> {
  return {
    attribute: rule.attribute,
    operator: rule.operator,
    values: rule.values,
    serve: rule.serve,
    rollout: rule.rollout,
  };
}

function overridesToWire(overrides: readonly PersistedOverride[]): Record<string, boolean> {
  return Object.fromEntries(overrides.map((o) => [o.unitId, o.serve]));
}

function configToWire(config: FlagConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    off_value: config.offValue,
    on_value: config.onValue,
    rollout_percentage: config.rolloutPercentage,
    salt: config.salt,
    version: config.version,
  };
}

/**
 * The both-environments wire shape `GET /flags` and `GET /flags/:key` return.
 * No `ETag` — each environment's `version` travels inside its own block.
 */
export function flagToWire(flag: FlagWithAllEnvironments): Record<string, unknown> {
  return {
    key: flag.flag.key,
    name: flag.flag.name,
    description: flag.flag.description,
    archived: flag.flag.archivedAt !== null,
    environments: {
      development: {
        ...configToWire(flag.environments.development.config),
        rules: flag.environments.development.rules.map(ruleToWire),
        overrides: overridesToWire(flag.environments.development.overrides),
      },
      production: {
        ...configToWire(flag.environments.production.config),
        rules: flag.environments.production.rules.map(ruleToWire),
        overrides: overridesToWire(flag.environments.production.overrides),
      },
    },
  };
}
