import { randomUUID } from 'node:crypto';
import type { Environment, FlagDefinition } from '@rodriab/feature-semaphore-core';
import { toFlagDefinition } from '../../../application/mappers/flag-definition.mapper.js';
import {
  DuplicateKeyError,
  NotFoundError,
  VersionConflictError,
} from '../../../application/errors/domain-error.js';
import type { Clock } from '../../../application/ports/clock.js';
import type {
  ConfigPatch,
  ConfigRef,
  FlagAggregate,
  FlagRepository,
  FlagWithAllEnvironments,
  NewFlag,
  NewFlagConfig,
  NewOverride,
  NewRule,
} from '../../../application/ports/flag-repository.js';
import type { MemoryConfigRow, MemoryFlagRow, StoreAccessor } from './store.js';

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

function assembleAggregate(
  store: ReturnType<StoreAccessor['get']>,
  flag: MemoryFlagRow,
  config: MemoryConfigRow,
): FlagAggregate {
  const rules = store.rules
    .filter((r) => r.flagConfigId === config.id)
    .slice()
    .sort((a, b) => a.position - b.position) // adapter's ORDER BY position ASC equivalent
    .map((r) => ({
      position: r.position,
      attribute: r.attribute,
      operator: r.operator,
      values: r.values,
      serve: r.serve,
      rollout: r.rollout,
    }));
  const overrides = store.overrides
    .filter((o) => o.flagConfigId === config.id)
    .map((o) => ({ unitId: o.unitId, serve: o.serve }));

  return {
    flag: {
      key: flag.key,
      name: flag.name,
      description: flag.description,
      archivedAt: flag.archivedAt,
    },
    config: {
      id: config.id,
      flagId: config.flagId,
      environment: config.environment,
      enabled: config.enabled,
      offValue: config.offValue,
      onValue: config.onValue,
      rolloutPercentage: config.rolloutPercentage,
      salt: config.salt,
      version: config.version,
      updatedAt: config.updatedAt,
    },
    rules,
    overrides,
  };
}

function findFlagConfig(
  store: ReturnType<StoreAccessor['get']>,
  ref: ConfigRef,
): { flag: MemoryFlagRow; config: MemoryConfigRow } | null {
  const flag = store.flags.find((f) => f.key === ref.flagKey);
  if (!flag) return null;
  const config = store.configs.find(
    (c) => c.flagId === flag.id && c.environment === ref.environment,
  );
  if (!config) return null;
  return { flag, config };
}

export function createMemoryFlagRepository(store: StoreAccessor, clock: Clock): FlagRepository {
  return {
    async findByKey(ref: ConfigRef): Promise<FlagAggregate | null> {
      const found = findFlagConfig(store.get(), ref);
      return Promise.resolve(
        found ? assembleAggregate(store.get(), found.flag, found.config) : null,
      );
    },

    async findAllEnvironmentsByKey(key: string): Promise<FlagWithAllEnvironments | null> {
      const s = store.get();
      const flag = s.flags.find((f) => f.key === key);
      if (!flag) return Promise.resolve(null);

      const environments: Record<string, unknown> = {};
      for (const env of ENVIRONMENTS) {
        const config = s.configs.find((c) => c.flagId === flag.id && c.environment === env);
        if (!config) continue;
        const aggregate = assembleAggregate(s, flag, config);
        environments[env] = {
          config: aggregate.config,
          rules: aggregate.rules,
          overrides: aggregate.overrides,
        };
      }

      return Promise.resolve({
        flag: {
          key: flag.key,
          name: flag.name,
          description: flag.description,
          archivedAt: flag.archivedAt,
        },
        environments: environments as FlagWithAllEnvironments['environments'],
      });
    },

    async listAllEnvironments(): Promise<readonly FlagWithAllEnvironments[]> {
      const s = store.get();
      const results: FlagWithAllEnvironments[] = [];
      for (const flag of s.flags) {
        const environments: Record<string, unknown> = {};
        for (const env of ENVIRONMENTS) {
          const config = s.configs.find((c) => c.flagId === flag.id && c.environment === env);
          if (!config) continue;
          const aggregate = assembleAggregate(s, flag, config);
          environments[env] = {
            config: aggregate.config,
            rules: aggregate.rules,
            overrides: aggregate.overrides,
          };
        }
        results.push({
          flag: {
            key: flag.key,
            name: flag.name,
            description: flag.description,
            archivedAt: flag.archivedAt,
          },
          environments: environments as FlagWithAllEnvironments['environments'],
        });
      }
      return Promise.resolve(results);
    },

    async listDefinitions(env: Environment): Promise<readonly FlagDefinition[]> {
      const s = store.get();
      const definitions: FlagDefinition[] = [];
      for (const flag of s.flags) {
        const config = s.configs.find((c) => c.flagId === flag.id && c.environment === env);
        if (!config) continue;
        definitions.push(toFlagDefinition(assembleAggregate(s, flag, config)));
      }
      return Promise.resolve(definitions);
    },

    async createFlag(
      input: NewFlag,
      configs: readonly NewFlagConfig[],
    ): Promise<FlagWithAllEnvironments> {
      const s = store.get();
      if (s.flags.some((f) => f.key === input.key)) {
        throw new DuplicateKeyError(input.key);
      }

      const flagId = randomUUID();
      const flagRow: MemoryFlagRow = {
        id: flagId,
        key: input.key,
        name: input.name,
        description: input.description,
        archivedAt: null,
      };
      s.flags.push(flagRow);

      for (const c of configs) {
        const configRow: MemoryConfigRow = {
          id: randomUUID(),
          flagId,
          environment: c.environment,
          enabled: c.enabled,
          offValue: c.offValue,
          onValue: c.onValue,
          rolloutPercentage: c.rolloutPercentage,
          salt: c.salt,
          version: 1,
          updatedAt: clock.now(),
        };
        s.configs.push(configRow);
      }

      const environments: Record<string, unknown> = {};
      for (const env of ENVIRONMENTS) {
        const config = s.configs.find((c) => c.flagId === flagId && c.environment === env);
        if (!config) continue;
        environments[env] = { config: { ...config }, rules: [], overrides: [] };
      }

      return Promise.resolve({
        flag: {
          key: flagRow.key,
          name: flagRow.name,
          description: flagRow.description,
          archivedAt: null,
        },
        environments: environments as FlagWithAllEnvironments['environments'],
      });
    },

    async updateConfig(
      ref: ConfigRef,
      patch: ConfigPatch,
      expectedVersion: number,
    ): Promise<number> {
      const found = findFlagConfig(store.get(), ref);
      if (!found) {
        throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      }
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      if (patch.enabled !== undefined) found.config.enabled = patch.enabled;
      if (patch.offValue !== undefined) found.config.offValue = patch.offValue;
      if (patch.onValue !== undefined) found.config.onValue = patch.onValue;
      if (patch.rolloutPercentage !== undefined)
        found.config.rolloutPercentage = patch.rolloutPercentage;
      found.config.version += 1;
      found.config.updatedAt = clock.now();

      return Promise.resolve(found.config.version);
    },

    async replaceRules(
      ref: ConfigRef,
      rules: readonly NewRule[],
      expectedVersion: number,
    ): Promise<number> {
      const s = store.get();
      const found = findFlagConfig(s, ref);
      if (!found) {
        throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      }
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      s.rules = s.rules.filter((r) => r.flagConfigId !== found.config.id);
      rules.forEach((rule, index) => {
        s.rules.push({
          id: randomUUID(),
          flagConfigId: found.config.id,
          position: index, // positions are assigned by the server (submitted order)
          attribute: rule.attribute,
          operator: rule.operator,
          values: rule.values,
          serve: rule.serve,
          rollout: rule.rollout,
        });
      });

      found.config.version += 1;
      found.config.updatedAt = clock.now();
      return Promise.resolve(found.config.version);
    },

    async replaceOverrides(
      ref: ConfigRef,
      overrides: readonly NewOverride[],
      expectedVersion: number,
    ): Promise<number> {
      const s = store.get();
      const found = findFlagConfig(s, ref);
      if (!found) {
        throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      }
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      s.overrides = s.overrides.filter((o) => o.flagConfigId !== found.config.id);
      for (const override of overrides) {
        s.overrides.push({
          id: randomUUID(),
          flagConfigId: found.config.id,
          unitId: override.unitId,
          serve: override.serve,
        });
      }

      found.config.version += 1;
      found.config.updatedAt = clock.now();
      return Promise.resolve(found.config.version);
    },

    async archiveFlag(key: string, at: Date): Promise<void> {
      const s = store.get();
      const flag = s.flags.find((f) => f.key === key);
      if (!flag) {
        throw new NotFoundError('flag', key);
      }
      flag.archivedAt = at;
      return Promise.resolve();
    },
  };
}
