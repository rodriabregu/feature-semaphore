import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Environment, FlagDefinition } from '@rodriab/feature-semaphore-core';
import {
  DuplicateKeyError,
  NotFoundError,
  VersionConflictError,
} from '../../../application/errors/domain-error.js';
import { toFlagDefinition } from '../../../application/mappers/flag-definition.mapper.js';
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
  PersistedOverride,
  PersistedRule,
} from '../../../application/ports/flag-repository.js';

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

interface FlagRowSql {
  id: string;
  key: string;
  name: string;
  description: string;
  archived_at: string | null;
}

interface ConfigRowSql {
  id: string;
  flag_id: string;
  environment: Environment;
  enabled: number;
  off_value: number;
  on_value: number;
  rollout_percentage: number;
  salt: string;
  version: number;
  updated_at: string;
}

interface RuleRowSql {
  position: number;
  attribute: string;
  operator: string;
  values: string;
  serve: number;
  rollout: number;
}

interface OverrideRowSql {
  unit_id: string;
  serve: number;
}

function toFlagRow(row: FlagRowSql): FlagAggregate['flag'] {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  };
}

function toConfig(row: ConfigRowSql): FlagAggregate['config'] {
  return {
    id: row.id,
    flagId: row.flag_id,
    environment: row.environment,
    enabled: row.enabled === 1,
    offValue: row.off_value === 1,
    onValue: row.on_value === 1,
    rolloutPercentage: row.rollout_percentage,
    salt: row.salt,
    version: row.version,
    updatedAt: new Date(row.updated_at),
  };
}

function toRules(rows: readonly RuleRowSql[]): readonly PersistedRule[] {
  return rows.map((r) => ({
    position: r.position,
    attribute: r.attribute,
    operator: r.operator,
    values: JSON.parse(r.values) as unknown,
    serve: r.serve === 1,
    rollout: r.rollout,
  }));
}

function toOverrides(rows: readonly OverrideRowSql[]): readonly PersistedOverride[] {
  return rows.map((o) => ({ unitId: o.unit_id, serve: o.serve === 1 }));
}

export function createSqliteFlagRepository(db: Database.Database, clock: Clock): FlagRepository {
  function loadRulesAndOverrides(configId: string): {
    rules: readonly PersistedRule[];
    overrides: readonly PersistedOverride[];
  } {
    const ruleRows = db
      .prepare<[string], RuleRowSql>(
        `SELECT position, attribute, operator, "values", serve, rollout
           FROM targeting_rules WHERE flag_config_id = ? ORDER BY position ASC`,
      )
      .all(configId);
    const overrideRows = db
      .prepare<[string], OverrideRowSql>(
        `SELECT unit_id, serve FROM overrides WHERE flag_config_id = ?`,
      )
      .all(configId);
    return { rules: toRules(ruleRows), overrides: toOverrides(overrideRows) };
  }

  function findFlagAndConfig(ref: ConfigRef): { flag: FlagRowSql; config: ConfigRowSql } | null {
    const flag = db
      .prepare<[string], FlagRowSql>(`SELECT * FROM flags WHERE key = ?`)
      .get(ref.flagKey);
    if (!flag) return null;
    const config = db
      .prepare<[string, string], ConfigRowSql>(
        `SELECT * FROM flag_configs WHERE flag_id = ? AND environment = ?`,
      )
      .get(flag.id, ref.environment);
    if (!config) return null;
    return { flag, config };
  }

  function assembleAggregate(flag: FlagRowSql, config: ConfigRowSql): FlagAggregate {
    const { rules, overrides } = loadRulesAndOverrides(config.id);
    return { flag: toFlagRow(flag), config: toConfig(config), rules, overrides };
  }

  function buildAllEnvironments(flag: FlagRowSql): FlagWithAllEnvironments {
    const environments: Record<string, unknown> = {};
    for (const env of ENVIRONMENTS) {
      const config = db
        .prepare<[string, string], ConfigRowSql>(
          `SELECT * FROM flag_configs WHERE flag_id = ? AND environment = ?`,
        )
        .get(flag.id, env);
      if (!config) continue;
      const { rules, overrides } = loadRulesAndOverrides(config.id);
      environments[env] = { config: toConfig(config), rules, overrides };
    }
    return {
      flag: toFlagRow(flag),
      environments: environments as FlagWithAllEnvironments['environments'],
    };
  }

  return {
    async findByKey(ref: ConfigRef): Promise<FlagAggregate | null> {
      const found = findFlagAndConfig(ref);
      return Promise.resolve(found ? assembleAggregate(found.flag, found.config) : null);
    },

    async findAllEnvironmentsByKey(key: string): Promise<FlagWithAllEnvironments | null> {
      const flag = db.prepare<[string], FlagRowSql>(`SELECT * FROM flags WHERE key = ?`).get(key);
      return Promise.resolve(flag ? buildAllEnvironments(flag) : null);
    },

    async listAllEnvironments(): Promise<readonly FlagWithAllEnvironments[]> {
      const flags = db.prepare<[], FlagRowSql>(`SELECT * FROM flags`).all();
      return Promise.resolve(flags.map((flag) => buildAllEnvironments(flag)));
    },

    async listDefinitions(env: Environment): Promise<readonly FlagDefinition[]> {
      const flags = db.prepare<[], FlagRowSql>(`SELECT * FROM flags`).all();
      const definitions: FlagDefinition[] = [];
      for (const flag of flags) {
        const config = db
          .prepare<[string, string], ConfigRowSql>(
            `SELECT * FROM flag_configs WHERE flag_id = ? AND environment = ?`,
          )
          .get(flag.id, env);
        if (!config) continue;
        definitions.push(toFlagDefinition(assembleAggregate(flag, config)));
      }
      return Promise.resolve(definitions);
    },

    async createFlag(
      input: NewFlag,
      configs: readonly NewFlagConfig[],
    ): Promise<FlagWithAllEnvironments> {
      const existing = db.prepare(`SELECT 1 FROM flags WHERE key = ?`).get(input.key);
      if (existing) {
        throw new DuplicateKeyError(input.key);
      }

      const flagId = randomUUID();
      const now = clock.now().toISOString();
      db.prepare(
        `INSERT INTO flags (id, key, name, description, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      ).run(flagId, input.key, input.name, input.description, now, now);

      for (const c of configs) {
        db.prepare(
          `INSERT INTO flag_configs
             (id, flag_id, environment, enabled, off_value, on_value, rollout_percentage, salt, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        ).run(
          randomUUID(),
          flagId,
          c.environment,
          c.enabled ? 1 : 0,
          c.offValue ? 1 : 0,
          c.onValue ? 1 : 0, // on_value explicit — never relies on the column default
          c.rolloutPercentage,
          c.salt,
          now,
        );
      }

      const flag = db.prepare<[string], FlagRowSql>(`SELECT * FROM flags WHERE id = ?`).get(flagId);
      if (!flag) throw new Error('INSERT ... did not produce a readable row');
      return Promise.resolve(buildAllEnvironments(flag));
    },

    async updateConfig(
      ref: ConfigRef,
      patch: ConfigPatch,
      expectedVersion: number,
    ): Promise<number> {
      const found = findFlagAndConfig(ref);
      if (!found) throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      const next = {
        enabled: patch.enabled === undefined ? found.config.enabled : patch.enabled ? 1 : 0,
        off_value: patch.offValue === undefined ? found.config.off_value : patch.offValue ? 1 : 0,
        on_value: patch.onValue === undefined ? found.config.on_value : patch.onValue ? 1 : 0,
        rollout_percentage: patch.rolloutPercentage ?? found.config.rollout_percentage,
      };
      const newVersion = found.config.version + 1;
      db.prepare(
        `UPDATE flag_configs
            SET enabled = ?, off_value = ?, on_value = ?, rollout_percentage = ?,
                version = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        next.enabled,
        next.off_value,
        next.on_value,
        next.rollout_percentage,
        newVersion,
        clock.now().toISOString(),
        found.config.id,
      );
      return Promise.resolve(newVersion);
    },

    async replaceRules(
      ref: ConfigRef,
      rules: readonly NewRule[],
      expectedVersion: number,
    ): Promise<number> {
      const found = findFlagAndConfig(ref);
      if (!found) throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      db.prepare(`DELETE FROM targeting_rules WHERE flag_config_id = ?`).run(found.config.id);
      rules.forEach((rule, index) => {
        db.prepare(
          `INSERT INTO targeting_rules
             (id, flag_config_id, position, attribute, operator, "values", serve, rollout)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          found.config.id,
          index,
          rule.attribute,
          rule.operator,
          JSON.stringify(rule.values),
          rule.serve ? 1 : 0,
          rule.rollout,
        );
      });

      const newVersion = found.config.version + 1;
      db.prepare(`UPDATE flag_configs SET version = ?, updated_at = ? WHERE id = ?`).run(
        newVersion,
        clock.now().toISOString(),
        found.config.id,
      );
      return Promise.resolve(newVersion);
    },

    async replaceOverrides(
      ref: ConfigRef,
      overrides: readonly NewOverride[],
      expectedVersion: number,
    ): Promise<number> {
      const found = findFlagAndConfig(ref);
      if (!found) throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      db.prepare(`DELETE FROM overrides WHERE flag_config_id = ?`).run(found.config.id);
      for (const o of overrides) {
        db.prepare(
          `INSERT INTO overrides (id, flag_config_id, unit_id, serve) VALUES (?, ?, ?, ?)`,
        ).run(randomUUID(), found.config.id, o.unitId, o.serve ? 1 : 0);
      }

      const newVersion = found.config.version + 1;
      db.prepare(`UPDATE flag_configs SET version = ?, updated_at = ? WHERE id = ?`).run(
        newVersion,
        clock.now().toISOString(),
        found.config.id,
      );
      return Promise.resolve(newVersion);
    },

    async archiveFlag(key: string, at: Date): Promise<void> {
      const result = db
        .prepare(`UPDATE flags SET archived_at = ?, updated_at = ? WHERE key = ?`)
        .run(at.toISOString(), at.toISOString(), key);
      if (result.changes === 0) throw new NotFoundError('flag', key);
      return Promise.resolve();
    },
  };
}
