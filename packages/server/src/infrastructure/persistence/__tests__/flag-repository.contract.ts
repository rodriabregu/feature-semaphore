import { evaluate } from '@rodriab/feature-semaphore-core';
import type { Environment } from '@rodriab/feature-semaphore-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CorruptRowError,
  NotFoundError,
  VersionConflictError,
} from '../../../application/errors/domain-error.js';
import { toFlagDefinition } from '../../../application/mappers/flag-definition.mapper.js';
import type { ApiKeyRepository } from '../../../application/ports/api-key-repository.js';
import type { AuditLog } from '../../../application/ports/audit-log.js';
import type { Clock } from '../../../application/ports/clock.js';
import type { ExposureRepository } from '../../../application/ports/exposure-repository.js';
import type {
  FlagRepository,
  NewFlag,
  NewFlagConfig,
} from '../../../application/ports/flag-repository.js';
import type { UnitOfWork } from '../../../application/ports/unit-of-work.js';

export interface AdapterHarness {
  readonly name: string;
  create(): Promise<{
    repo: FlagRepository;
    keys: ApiKeyRepository;
    audit: AuditLog;
    uow: UnitOfWork;
    exposures: ExposureRepository;
    clock: Clock;
    /**
     * Test-only: inserts a raw `api_keys` row bypassing `ApiKeyRepository`'s
     * public surface (which only ever writes `environment: NULL` admin rows).
     * Used exclusively by case 18 to prove the admin/environment invariant at
     * the storage layer itself — a real `CHECK` for SQLite/Postgres, the
     * equivalent code-level guard for the memory adapter.
     */
    insertRawApiKey(row: {
      kind: 'admin' | 'server';
      environment: Environment | null;
    }): Promise<void>;
    /** Test-only: reads back raw `exposures` rows for case 21/22 assertions. */
    countExposureRows(): Promise<number>;
    teardown(): Promise<void>;
  }>;
}

/** Asserts a value the test itself just established, without a `!` assertion. */
function defined<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  return value as T;
}

function newFlag(key: string): NewFlag {
  return { key, name: key, description: '' };
}

function newConfigs(overrides: Partial<NewFlagConfig> = {}): readonly NewFlagConfig[] {
  const base = {
    enabled: true,
    offValue: false,
    onValue: true,
    rolloutPercentage: 0,
    salt: 'salt-value',
  };
  return [
    { ...base, environment: 'development', ...overrides },
    { ...base, environment: 'production', ...overrides },
  ];
}

export function describeFlagRepositoryContract(harness: AdapterHarness): void {
  describe(`FlagRepository contract: ${harness.name}`, () => {
    let ctx: Awaited<ReturnType<AdapterHarness['create']>>;

    beforeEach(async () => {
      ctx = await harness.create();
    });

    afterEach(async () => {
      await ctx.teardown();
    });

    it('case 1: create then findByKey round-trips the aggregate intact', async () => {
      await ctx.repo.createFlag(newFlag('flag-1'), newConfigs());

      const aggregate = await ctx.repo.findByKey({ flagKey: 'flag-1', environment: 'development' });

      const found = defined(aggregate);
      expect(found.flag.key).toBe('flag-1');
      expect(found.config.environment).toBe('development');
      expect(found.config.version).toBe(1);
    });

    it('case 2: findAllEnvironmentsByKey returns both environments', async () => {
      await ctx.repo.createFlag(newFlag('flag-2'), newConfigs());

      const both = await ctx.repo.findAllEnvironmentsByKey('flag-2');

      const found = defined(both);
      expect(found.environments.development).toBeDefined();
      expect(found.environments.production).toBeDefined();
    });

    it('case 3: on_value defaults to true on create, in both environments', async () => {
      await ctx.repo.createFlag(newFlag('flag-3'), newConfigs());

      const found = defined(await ctx.repo.findAllEnvironmentsByKey('flag-3'));

      expect(found.environments.development.config.onValue).toBe(true);
      expect(found.environments.production.config.onValue).toBe(true);
    });

    it('case 4: duplicate key raises DuplicateKeyError carrying the key', async () => {
      await ctx.repo.createFlag(newFlag('flag-4'), newConfigs());

      await expect(ctx.repo.createFlag(newFlag('flag-4'), newConfigs())).rejects.toMatchObject({
        code: 'duplicate_key',
        key: 'flag-4',
      });
    });

    it('case 5: updateConfig happy path returns expectedVersion + 1', async () => {
      await ctx.repo.createFlag(newFlag('flag-5'), newConfigs());

      const newVersion = await ctx.repo.updateConfig(
        { flagKey: 'flag-5', environment: 'development' },
        { enabled: false },
        1,
      );

      expect(newVersion).toBe(2);
    });

    it('case 6: updateConfig with a stale version raises VersionConflictError(expected, actual)', async () => {
      await ctx.repo.createFlag(newFlag('flag-6'), newConfigs());
      await ctx.repo.updateConfig(
        { flagKey: 'flag-6', environment: 'development' },
        { enabled: false },
        1,
      );

      await expect(
        ctx.repo.updateConfig(
          { flagKey: 'flag-6', environment: 'development' },
          { enabled: true },
          1,
        ),
      ).rejects.toBeInstanceOf(VersionConflictError);

      try {
        await ctx.repo.updateConfig(
          { flagKey: 'flag-6', environment: 'development' },
          { enabled: true },
          1,
        );
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(VersionConflictError);
        expect((error as VersionConflictError).expected).toBe(1);
        expect((error as VersionConflictError).actual).toBe(2);
      }
    });

    it('case 7: updateConfig on a missing config raises NotFoundError, not VersionConflictError', async () => {
      await expect(
        ctx.repo.updateConfig({ flagKey: 'no-such-flag', environment: 'development' }, {}, 1),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("case 8: bumping production's version leaves development's untouched", async () => {
      await ctx.repo.createFlag(newFlag('flag-8'), newConfigs());
      await ctx.repo.updateConfig(
        { flagKey: 'flag-8', environment: 'production' },
        { enabled: false },
        1,
      );

      const found = defined(await ctx.repo.findAllEnvironmentsByKey('flag-8'));
      expect(found.environments.production.config.version).toBe(2);
      expect(found.environments.development.config.version).toBe(1);
    });

    it('case 9: replaceRules written in positions [2,0,1] read back ordered [0,1,2]', async () => {
      await ctx.repo.createFlag(newFlag('flag-9'), newConfigs());
      const ruleC = { attribute: 'c', operator: 'in', values: ['x'], serve: true, rollout: 100 };
      const ruleA = { attribute: 'a', operator: 'in', values: ['x'], serve: true, rollout: 100 };
      const ruleB = { attribute: 'b', operator: 'in', values: ['x'], serve: true, rollout: 100 };

      // Submitted array order IS the rule order; the adapter assigns position = index.
      await ctx.repo.replaceRules(
        { flagKey: 'flag-9', environment: 'development' },
        [ruleC, ruleA, ruleB],
        1,
      );

      const aggregate = defined(
        await ctx.repo.findByKey({ flagKey: 'flag-9', environment: 'development' }),
      );
      expect(aggregate.rules.map((r) => r.attribute)).toEqual(['c', 'a', 'b']);
      expect(aggregate.rules.map((r) => r.position)).toEqual([0, 1, 2]);
    });

    it('case 10: the same rules through toFlagDefinition + evaluate() match by intended index', async () => {
      await ctx.repo.createFlag(newFlag('flag-10'), newConfigs());
      const ruleFirst = {
        attribute: 'country',
        operator: 'in',
        values: ['US'],
        serve: true,
        rollout: 100,
      };
      const ruleSecond = {
        attribute: 'country',
        operator: 'in',
        values: ['CA'],
        serve: false,
        rollout: 100,
      };

      await ctx.repo.replaceRules(
        { flagKey: 'flag-10', environment: 'development' },
        [ruleFirst, ruleSecond],
        1,
      );

      const aggregate = defined(
        await ctx.repo.findByKey({ flagKey: 'flag-10', environment: 'development' }),
      );
      const definition = toFlagDefinition(aggregate);

      const evaluation = evaluate(definition, {
        unitId: 'user-1',
        attributes: { country: 'CA' },
        defaultValue: false,
      });
      expect(evaluation.reason).toBe('RULE_MATCH:1');
      expect(evaluation.value).toBe(false);
    });

    it('case 11: rollout round-trips as a plain number, exactly 33.33', async () => {
      await ctx.repo.createFlag(newFlag('flag-11'), newConfigs({ rolloutPercentage: 33.33 }));

      const aggregate = defined(
        await ctx.repo.findByKey({ flagKey: 'flag-11', environment: 'development' }),
      );
      expect(typeof aggregate.config.rolloutPercentage).toBe('number');
      expect(aggregate.config.rolloutPercentage).toBe(33.33);
    });

    it("case 12: replaceOverrides round-trips a unit_id of '__proto__' as a real own property", async () => {
      await ctx.repo.createFlag(newFlag('flag-12'), newConfigs());

      await ctx.repo.replaceOverrides(
        { flagKey: 'flag-12', environment: 'development' },
        [{ unitId: '__proto__', serve: true }],
        1,
      );

      const aggregate = defined(
        await ctx.repo.findByKey({ flagKey: 'flag-12', environment: 'development' }),
      );
      const definition = toFlagDefinition(aggregate);
      expect(Object.hasOwn(definition.overrides, '__proto__')).toBe(true);
      // Asserting the literal bracket-access path a malicious unit_id would exercise.
      // eslint-disable-next-line @typescript-eslint/dot-notation
      expect(definition.overrides['__proto__']).toBe(true);
    });

    it('case 13: an archived flag appears in listDefinitions with archived: true', async () => {
      await ctx.repo.createFlag(newFlag('flag-13'), newConfigs());
      await ctx.repo.archiveFlag('flag-13', ctx.clock.now());

      const definitions = await ctx.repo.listDefinitions('development');
      const found = definitions.find((d) => d.key === 'flag-13');
      expect(found?.archived).toBe(true);
    });

    it('case 14: an archived flag is still returned by findByKey', async () => {
      await ctx.repo.createFlag(newFlag('flag-14'), newConfigs());
      await ctx.repo.archiveFlag('flag-14', ctx.clock.now());

      const aggregate = defined(
        await ctx.repo.findByKey({ flagKey: 'flag-14', environment: 'development' }),
      );
      expect(aggregate.flag.archivedAt).not.toBeNull();
    });

    it('case 15: audit record then read back with full before/after — snapshot fidelity', async () => {
      // `audit_log.actor` references `api_keys.id`, so the actor must be a real row.
      await ctx.keys.ensureAdminKey('hash-for-case-15', ctx.clock.now());
      const actor = defined(await ctx.keys.findByHash('hash-for-case-15'));

      await ctx.uow.transact(async (transactionCtx) => {
        await transactionCtx.flags.createFlag(newFlag('flag-15'), newConfigs());
        await transactionCtx.audit.record({
          actor: actor.id,
          flagKey: 'flag-15',
          environment: null,
          action: 'flag.created',
          before: null,
          after: { onValue: true },
          createdAt: ctx.clock.now(),
        });
      });

      const entries = await ctx.audit.findByFlagKey('flag-15', 10);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.before).toBeNull();
      expect(entries[0]?.after).toEqual({ onValue: true });
    });

    it('case 16: a failing audit write leaves no flag behind — transaction atomicity', async () => {
      await expect(
        ctx.uow.transact(async (transactionCtx) => {
          await transactionCtx.flags.createFlag(newFlag('flag-16'), newConfigs());
          throw new Error('audit write failed');
        }),
      ).rejects.toThrow('audit write failed');

      const aggregate = await ctx.repo.findByKey({
        flagKey: 'flag-16',
        environment: 'development',
      });
      expect(aggregate).toBeNull();
    });

    it('case 17: a rule row whose values violate the union throws CorruptRowError on decode', async () => {
      await ctx.repo.createFlag(newFlag('flag-17'), newConfigs());
      // Bypasses the HTTP edge's Zod validation on purpose — this is what a
      // corrupted or hand-inserted row looks like at read time.
      await ctx.repo.replaceRules(
        { flagKey: 'flag-17', environment: 'development' },
        [{ attribute: 'age', operator: 'gt', values: ['not-a-number'], serve: true, rollout: 50 }],
        1,
      );

      const aggregate = defined(
        await ctx.repo.findByKey({ flagKey: 'flag-17', environment: 'development' }),
      );
      expect(() => toFlagDefinition(aggregate)).toThrow(CorruptRowError);
    });

    it('case 18: ensureAdminKey twice inserts one row; a non-null-environment admin row is rejected', async () => {
      await ctx.keys.ensureAdminKey('hash-abc', ctx.clock.now());
      await ctx.keys.ensureAdminKey('hash-abc', ctx.clock.now());

      const record = defined(await ctx.keys.findByHash('hash-abc'));
      expect(record.environment).toBeNull();

      await expect(
        ctx.insertRawApiKey({ kind: 'admin', environment: 'development' }),
      ).rejects.toThrow();
    });

    it('case 19: ensureServerKey twice inserts one row, environment non-null', async () => {
      await ctx.keys.ensureServerKey('hash-server-1', 'development', ctx.clock.now());
      await ctx.keys.ensureServerKey('hash-server-1', 'development', ctx.clock.now());

      const record = defined(await ctx.keys.findByHash('hash-server-1'));
      expect(record.kind).toBe('server');
      expect(record.environment).toBe('development');
    });

    it('case 20: a server row with a NULL environment is rejected', async () => {
      await expect(ctx.insertRawApiKey({ kind: 'server', environment: null })).rejects.toThrow();
    });

    it('case 21: two recordBatch calls with the same tuple -> one row, summed count', async () => {
      const row = {
        flagKey: 'checkout-v2',
        environment: 'development' as const,
        bucketHour: new Date('2026-01-01T14:00:00.000Z'),
        value: true,
        reason: 'FALLTHROUGH_ROLLOUT',
        count: 1,
      };

      await ctx.exposures.recordBatch([row]);
      await ctx.exposures.recordBatch([{ ...row, count: 2 }]);

      expect(await ctx.countExposureRows()).toBe(1);
    });

    it('case 22: two rows differing only in reason -> two rows', async () => {
      const base = {
        flagKey: 'checkout-v3',
        environment: 'development' as const,
        bucketHour: new Date('2026-01-01T15:00:00.000Z'),
        value: true,
        count: 1,
      };

      await ctx.exposures.recordBatch([{ ...base, reason: 'FLAG_OFF' }]);
      await ctx.exposures.recordBatch([{ ...base, reason: 'OVERRIDE' }]);

      expect(await ctx.countExposureRows()).toBe(2);
    });
  });
}
