import { randomUUID } from 'node:crypto';
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
import type { Queryable } from './queryable.js';

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];
const UNIQUE_VIOLATION = '23505';

interface FlagRowSql {
  id: string;
  key: string;
  name: string;
  description: string;
  archived_at: Date | null;
}

interface ConfigRowSql {
  id: string;
  flag_id: string;
  environment: Environment;
  enabled: boolean;
  off_value: boolean;
  on_value: boolean;
  rollout_percentage: string; // node-postgres returns NUMERIC as a string
  salt: string;
  version: number;
  updated_at: Date;
}

interface RuleRowSql {
  position: number;
  attribute: string;
  operator: string;
  values: unknown; // JSONB decoded natively by pg
  serve: boolean;
  rollout: string;
}

interface OverrideRowSql {
  unit_id: string;
  serve: boolean;
}

function toFlagRow(row: FlagRowSql): FlagAggregate['flag'] {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    archivedAt: row.archived_at,
  };
}

function toConfig(row: ConfigRowSql): FlagAggregate['config'] {
  return {
    id: row.id,
    flagId: row.flag_id,
    environment: row.environment,
    enabled: row.enabled,
    offValue: row.off_value,
    onValue: row.on_value,
    // NUMERIC(5,2) round-trips through node-postgres as a string — an explicit
    // conversion, never a global type-parser registration that would mutate
    // driver state process-wide.
    rolloutPercentage: Number(row.rollout_percentage),
    salt: row.salt,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function toRules(rows: readonly RuleRowSql[]): readonly PersistedRule[] {
  return rows.map((r) => ({
    position: r.position,
    attribute: r.attribute,
    operator: r.operator,
    values: r.values,
    serve: r.serve,
    rollout: Number(r.rollout),
  }));
}

function toOverrides(rows: readonly OverrideRowSql[]): readonly PersistedOverride[] {
  return rows.map((o) => ({ unitId: o.unit_id, serve: o.serve }));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export function createPostgresFlagRepository(db: Queryable, clock: Clock): FlagRepository {
  async function loadRulesAndOverrides(
    configId: string,
  ): Promise<{ rules: readonly PersistedRule[]; overrides: readonly PersistedOverride[] }> {
    const ruleRows = await db.query<RuleRowSql>(
      `SELECT position, attribute, operator, "values", serve, rollout
         FROM targeting_rules WHERE flag_config_id = $1 ORDER BY position ASC`,
      [configId],
    );
    const overrideRows = await db.query<OverrideRowSql>(
      `SELECT unit_id, serve FROM overrides WHERE flag_config_id = $1`,
      [configId],
    );
    return { rules: toRules(ruleRows.rows), overrides: toOverrides(overrideRows.rows) };
  }

  async function findFlagAndConfig(
    ref: ConfigRef,
  ): Promise<{ flag: FlagRowSql; config: ConfigRowSql } | null> {
    const flagResult = await db.query<FlagRowSql>(`SELECT * FROM flags WHERE key = $1`, [
      ref.flagKey,
    ]);
    const flag = flagResult.rows.at(0);
    if (!flag) return null;
    const configResult = await db.query<ConfigRowSql>(
      `SELECT * FROM flag_configs WHERE flag_id = $1 AND environment = $2`,
      [flag.id, ref.environment],
    );
    const config = configResult.rows.at(0);
    if (!config) return null;
    return { flag, config };
  }

  async function assembleAggregate(flag: FlagRowSql, config: ConfigRowSql): Promise<FlagAggregate> {
    const { rules, overrides } = await loadRulesAndOverrides(config.id);
    return { flag: toFlagRow(flag), config: toConfig(config), rules, overrides };
  }

  async function buildAllEnvironments(flag: FlagRowSql): Promise<FlagWithAllEnvironments> {
    const environments: Record<string, unknown> = {};
    for (const env of ENVIRONMENTS) {
      const configResult = await db.query<ConfigRowSql>(
        `SELECT * FROM flag_configs WHERE flag_id = $1 AND environment = $2`,
        [flag.id, env],
      );
      const config = configResult.rows.at(0);
      if (!config) continue;
      const { rules, overrides } = await loadRulesAndOverrides(config.id);
      environments[env] = { config: toConfig(config), rules, overrides };
    }
    return {
      flag: toFlagRow(flag),
      environments: environments as FlagWithAllEnvironments['environments'],
    };
  }

  return {
    async findByKey(ref: ConfigRef): Promise<FlagAggregate | null> {
      const found = await findFlagAndConfig(ref);
      return found ? assembleAggregate(found.flag, found.config) : null;
    },

    async findAllEnvironmentsByKey(key: string): Promise<FlagWithAllEnvironments | null> {
      const result = await db.query<FlagRowSql>(`SELECT * FROM flags WHERE key = $1`, [key]);
      const flag = result.rows.at(0);
      return flag ? buildAllEnvironments(flag) : null;
    },

    async listAllEnvironments(): Promise<readonly FlagWithAllEnvironments[]> {
      const result = await db.query<FlagRowSql>(`SELECT * FROM flags`);
      const out: FlagWithAllEnvironments[] = [];
      for (const flag of result.rows) {
        out.push(await buildAllEnvironments(flag));
      }
      return out;
    },

    async listDefinitions(env: Environment): Promise<readonly FlagDefinition[]> {
      const result = await db.query<FlagRowSql>(`SELECT * FROM flags`);
      const definitions: FlagDefinition[] = [];
      for (const flag of result.rows) {
        const configResult = await db.query<ConfigRowSql>(
          `SELECT * FROM flag_configs WHERE flag_id = $1 AND environment = $2`,
          [flag.id, env],
        );
        const config = configResult.rows.at(0);
        if (!config) continue;
        definitions.push(toFlagDefinition(await assembleAggregate(flag, config)));
      }
      return definitions;
    },

    async createFlag(
      input: NewFlag,
      configs: readonly NewFlagConfig[],
    ): Promise<FlagWithAllEnvironments> {
      const flagId = randomUUID();
      const now = clock.now();
      let insertedFlag: FlagRowSql;
      try {
        const result = await db.query<FlagRowSql>(
          `INSERT INTO flags (id, key, name, description, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
          [flagId, input.key, input.name, input.description, now],
        );
        const row = result.rows.at(0);
        if (!row) throw new Error('INSERT ... RETURNING produced no row');
        insertedFlag = row;
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateKeyError(input.key);
        throw error;
      }

      for (const c of configs) {
        await db.query(
          `INSERT INTO flag_configs
             (id, flag_id, environment, enabled, off_value, on_value, rollout_percentage, salt, version, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
          [
            randomUUID(),
            flagId,
            c.environment,
            c.enabled,
            c.offValue,
            c.onValue,
            c.rolloutPercentage,
            c.salt,
            now,
          ],
        );
      }

      return buildAllEnvironments(insertedFlag);
    },

    async updateConfig(
      ref: ConfigRef,
      patch: ConfigPatch,
      expectedVersion: number,
    ): Promise<number> {
      const found = await findFlagAndConfig(ref);
      if (!found) throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      const newVersion = found.config.version + 1;
      await db.query(
        `UPDATE flag_configs
            SET enabled = $2, off_value = $3, on_value = $4, rollout_percentage = $5,
                version = $6, updated_at = $7
          WHERE id = $1`,
        [
          found.config.id,
          patch.enabled ?? found.config.enabled,
          patch.offValue ?? found.config.off_value,
          patch.onValue ?? found.config.on_value,
          patch.rolloutPercentage ?? Number(found.config.rollout_percentage),
          newVersion,
          clock.now(),
        ],
      );
      return newVersion;
    },

    async replaceRules(
      ref: ConfigRef,
      rules: readonly NewRule[],
      expectedVersion: number,
    ): Promise<number> {
      const found = await findFlagAndConfig(ref);
      if (!found) throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      await db.query(`DELETE FROM targeting_rules WHERE flag_config_id = $1`, [found.config.id]);
      let index = 0;
      for (const rule of rules) {
        await db.query(
          `INSERT INTO targeting_rules
             (id, flag_config_id, position, attribute, operator, "values", serve, rollout)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            found.config.id,
            index,
            rule.attribute,
            rule.operator,
            JSON.stringify(rule.values),
            rule.serve,
            rule.rollout,
          ],
        );
        index += 1;
      }

      const newVersion = found.config.version + 1;
      await db.query(`UPDATE flag_configs SET version = $2, updated_at = $3 WHERE id = $1`, [
        found.config.id,
        newVersion,
        clock.now(),
      ]);
      return newVersion;
    },

    async replaceOverrides(
      ref: ConfigRef,
      overrides: readonly NewOverride[],
      expectedVersion: number,
    ): Promise<number> {
      const found = await findFlagAndConfig(ref);
      if (!found) throw new NotFoundError('flag config', `${ref.flagKey}/${ref.environment}`);
      if (found.config.version !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, found.config.version);
      }

      await db.query(`DELETE FROM overrides WHERE flag_config_id = $1`, [found.config.id]);
      for (const o of overrides) {
        await db.query(
          `INSERT INTO overrides (id, flag_config_id, unit_id, serve) VALUES ($1, $2, $3, $4)`,
          [randomUUID(), found.config.id, o.unitId, o.serve],
        );
      }

      const newVersion = found.config.version + 1;
      await db.query(`UPDATE flag_configs SET version = $2, updated_at = $3 WHERE id = $1`, [
        found.config.id,
        newVersion,
        clock.now(),
      ]);
      return newVersion;
    },

    async archiveFlag(key: string, at: Date): Promise<void> {
      const result = await db.query(
        `UPDATE flags SET archived_at = $2, updated_at = $2 WHERE key = $1`,
        [key, at],
      );
      if (result.rowCount === 0) throw new NotFoundError('flag', key);
    },
  };
}
