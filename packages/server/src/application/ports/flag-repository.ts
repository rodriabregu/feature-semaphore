// D7: `Environment` is importable only after core's index re-exports it.
import type { Environment, FlagDefinition, FlagValue } from '@rodriab/feature-semaphore-core';

export interface ConfigRef {
  readonly flagKey: string;
  readonly environment: Environment;
}

/** The raw per-environment persistence row. Declared HERE, not in core. */
export interface FlagConfig {
  readonly id: string;
  readonly flagId: string;
  readonly environment: Environment;
  readonly enabled: boolean;
  readonly offValue: FlagValue;
  readonly onValue: FlagValue;
  readonly rolloutPercentage: number; // 0..100, at most 2 decimals
  readonly salt: string;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface PersistedRule {
  readonly position: number;
  readonly attribute: string;
  readonly operator: string;
  readonly values: unknown; // JSONB / TEXT — undecoded on purpose
  readonly serve: boolean;
  readonly rollout: number;
}

export interface PersistedOverride {
  readonly unitId: string;
  readonly serve: boolean;
}

export interface FlagRow {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly archivedAt: Date | null;
}

/** @precondition `rules` is ordered by `position` ASC. The ADAPTER owns this, never the mapper. */
export interface FlagAggregate {
  readonly flag: FlagRow;
  readonly config: FlagConfig;
  readonly rules: readonly PersistedRule[];
  readonly overrides: readonly PersistedOverride[];
}

/** The both-environments read shape `GET /flags` and `GET /flags/:key` return. */
export interface FlagWithAllEnvironments {
  readonly flag: FlagRow;
  readonly environments: Readonly<
    Record<
      Environment,
      {
        readonly config: FlagConfig;
        readonly rules: readonly PersistedRule[];
        readonly overrides: readonly PersistedOverride[];
      }
    >
  >;
}

export interface NewFlag {
  readonly key: string;
  readonly name: string;
  readonly description: string;
}

export interface NewFlagConfig {
  readonly environment: Environment;
  readonly enabled: boolean;
  readonly offValue: FlagValue;
  readonly onValue: FlagValue;
  readonly rolloutPercentage: number;
  readonly salt: string;
}

export interface NewRule {
  readonly attribute: string;
  readonly operator: string;
  readonly values: unknown;
  readonly serve: boolean;
  readonly rollout: number;
}

export interface NewOverride {
  readonly unitId: string;
  readonly serve: boolean;
}

export interface ConfigPatch {
  readonly enabled?: boolean;
  readonly offValue?: FlagValue;
  readonly onValue?: FlagValue;
  readonly rolloutPercentage?: number;
}

export interface FlagRepository {
  findByKey(ref: ConfigRef): Promise<FlagAggregate | null>;

  /** Both environments in one round trip, not two calls the handler stitches. */
  findAllEnvironmentsByKey(key: string): Promise<FlagWithAllEnvironments | null>;
  listAllEnvironments(): Promise<readonly FlagWithAllEnvironments[]>;

  /** Environment-scoped by ARGUMENT, not by credential. Feeds the Phase 3 SDK read. */
  listDefinitions(env: Environment): Promise<readonly FlagDefinition[]>;

  /** @throws DuplicateKeyError when `flags.key` already exists. */
  createFlag(input: NewFlag, configs: readonly NewFlagConfig[]): Promise<FlagWithAllEnvironments>;

  /**
   * Conditional update of the single `version` counter for (flagKey, environment).
   * @returns the NEW version, already incremented.
   * @throws NotFoundError         no config row for that (key, environment)
   * @throws VersionConflictError  the row exists and its version !== expectedVersion
   */
  updateConfig(ref: ConfigRef, patch: ConfigPatch, expectedVersion: number): Promise<number>;

  /** Same version contract as updateConfig. Replaces the whole ordered set. */
  replaceRules(ref: ConfigRef, rules: readonly NewRule[], expectedVersion: number): Promise<number>;
  replaceOverrides(
    ref: ConfigRef,
    overrides: readonly NewOverride[],
    expectedVersion: number,
  ): Promise<number>;

  /** @throws NotFoundError */
  archiveFlag(key: string, at: Date): Promise<void>;
}
