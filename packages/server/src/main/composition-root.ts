import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type { AuditLog } from '../application/ports/audit-log.js';
import type { Clock } from '../application/ports/clock.js';
import type { ApiKeyRepository } from '../application/ports/api-key-repository.js';
import type { ExposureRepository } from '../application/ports/exposure-repository.js';
import type { FlagRepository } from '../application/ports/flag-repository.js';
import type { UnitOfWork } from '../application/ports/unit-of-work.js';
import { createSystemClock } from '../infrastructure/clock/system-clock.js';
import { registerErrorHandler } from '../infrastructure/http/error-handler.js';
import {
  createServerLogger,
  type ServerLoggerOverrides,
} from '../infrastructure/logging/logger.js';
import { authPlugin } from '../infrastructure/http/plugins/auth.js';
import { sdkAuthPlugin } from '../infrastructure/http/plugins/sdk-auth.js';
import { createHistogram } from '../infrastructure/http/metrics/histogram.js';
import { registerConfigRoutes } from '../infrastructure/http/routes/config.routes.js';
import { registerEvaluateRoutes } from '../infrastructure/http/routes/evaluate.routes.js';
import { registerExposuresRoutes } from '../infrastructure/http/routes/exposures.routes.js';
import { registerFlagsRoutes } from '../infrastructure/http/routes/flags.routes.js';
import { registerMetricsRoutes } from '../infrastructure/http/routes/metrics.routes.js';
import { registerOverridesRoutes } from '../infrastructure/http/routes/overrides.routes.js';
import { registerRulesRoutes } from '../infrastructure/http/routes/rules.routes.js';
import { registerSdkRoutes } from '../infrastructure/http/routes/sdk.routes.js';
import { createMemoryApiKeyRepository } from '../infrastructure/persistence/memory/api-key-repository.memory.js';
import { createMemoryAuditLog } from '../infrastructure/persistence/memory/audit-log.memory.js';
import { createMemoryExposureRepository } from '../infrastructure/persistence/memory/exposure-repository.memory.js';
import { createMemoryFlagRepository } from '../infrastructure/persistence/memory/flag-repository.memory.js';
import { MemoryDatabase } from '../infrastructure/persistence/memory/store.js';
import { createMemoryUnitOfWork } from '../infrastructure/persistence/memory/unit-of-work.memory.js';
import {
  POSTGRES_MIGRATIONS,
  SQLITE_MIGRATIONS,
} from '../infrastructure/persistence/migrations/index.js';
import { migrate } from '../infrastructure/persistence/migrations/runner.js';
import { seedAdminKey } from '../infrastructure/persistence/seed/admin-key.js';
import { seedServerKeys } from '../infrastructure/persistence/seed/server-key.js';

export type DatabaseDriver = 'memory' | 'sqlite' | 'postgres';

export interface CompositionConfig {
  readonly databaseDriver: DatabaseDriver;
  readonly adminApiKey: string | undefined;
  readonly databaseUrl?: string;
  readonly sqliteFile?: string;
  /**
   * Optional per environment — the SDK API is optional per environment,
   * unlike the admin key. An absent env var is tolerated; a SET but
   * malformed one still fails startup (`seed/server-key.ts`).
   */
  readonly serverApiKeys?: Readonly<Record<Environment, string | undefined>>;
}

const NO_SERVER_KEYS: Readonly<Record<Environment, string | undefined>> = {
  development: undefined,
  production: undefined,
};

export interface Composition {
  readonly app: FastifyInstance;
  /**
   * Runs migrations then seeds the admin key, flipping `/readyz` from 503 to
   * 200 on success. The caller (the real entrypoint, or a test) controls
   * exactly when this runs — `buildApp` itself never calls it, so the
   * pre-ready window is observable rather than a timing race.
   */
  readonly start: () => Promise<void>;
}

interface Adapters {
  readonly repo: FlagRepository;
  readonly keys: ApiKeyRepository;
  readonly audit: AuditLog;
  readonly uow: UnitOfWork;
  readonly exposures: ExposureRepository;
  /**
   * Runs migrations (a no-op for memory), then seeds the admin key, then
   * seeds the per-environment server keys — same order and same startup
   * lock in every driver.
   */
  readonly migrateAndSeed: (
    adminApiKey: string | undefined,
    serverApiKeys: Readonly<Record<Environment, string | undefined>>,
  ) => Promise<void>;
}

function buildMemoryAdapters(clock: Clock): Adapters {
  const db = new MemoryDatabase();
  const store = { get: () => db.current };
  const keys = createMemoryApiKeyRepository(store);

  return {
    repo: createMemoryFlagRepository(store, clock),
    keys,
    audit: createMemoryAuditLog(store),
    uow: createMemoryUnitOfWork(db, clock),
    exposures: createMemoryExposureRepository(store),
    // The memory adapter has no schema to migrate — only the key seeds apply.
    migrateAndSeed: async (adminApiKey, serverApiKeys) => {
      await seedAdminKey(keys, adminApiKey, clock);
      await seedServerKeys(keys, serverApiKeys, clock);
    },
  };
}

async function buildSqliteAdapters(sqliteFile: string, clock: Clock): Promise<Adapters> {
  const { openSqliteDatabase, createSqliteMigrationConnection } =
    await import('../infrastructure/persistence/sqlite/connection.js');
  const { createSqliteFlagRepository } =
    await import('../infrastructure/persistence/sqlite/flag-repository.sqlite.js');
  const { createSqliteApiKeyRepository } =
    await import('../infrastructure/persistence/sqlite/api-key-repository.sqlite.js');
  const { createSqliteAuditLog } =
    await import('../infrastructure/persistence/sqlite/audit-log.sqlite.js');
  const { createSqliteUnitOfWork } =
    await import('../infrastructure/persistence/sqlite/unit-of-work.sqlite.js');
  const { createSqliteExposureRepository } =
    await import('../infrastructure/persistence/sqlite/exposure-repository.sqlite.js');

  const db = openSqliteDatabase(sqliteFile);
  const keys = createSqliteApiKeyRepository(db);

  return {
    repo: createSqliteFlagRepository(db, clock),
    keys,
    audit: createSqliteAuditLog(db),
    uow: createSqliteUnitOfWork(db, clock),
    exposures: createSqliteExposureRepository(db),
    migrateAndSeed: async (adminApiKey, serverApiKeys) => {
      await migrate(createSqliteMigrationConnection(db), SQLITE_MIGRATIONS, () => clock.now());
      await seedAdminKey(keys, adminApiKey, clock);
      await seedServerKeys(keys, serverApiKeys, clock);
    },
  };
}

async function buildPostgresAdapters(databaseUrl: string, clock: Clock): Promise<Adapters> {
  const pg = await import('pg');
  const { Pool, Client } = pg.default;
  const { createPostgresMigrationConnection } =
    await import('../infrastructure/persistence/postgres/connection.js');
  const { createPostgresFlagRepository } =
    await import('../infrastructure/persistence/postgres/flag-repository.pg.js');
  const { createPostgresApiKeyRepository } =
    await import('../infrastructure/persistence/postgres/api-key-repository.pg.js');
  const { createPostgresAuditLog } =
    await import('../infrastructure/persistence/postgres/audit-log.pg.js');
  const { createPostgresUnitOfWork } =
    await import('../infrastructure/persistence/postgres/unit-of-work.pg.js');
  const { createPostgresExposureRepository } =
    await import('../infrastructure/persistence/postgres/exposure-repository.pg.js');

  const pool = new Pool({ connectionString: databaseUrl });
  const keys = createPostgresApiKeyRepository(pool);

  return {
    repo: createPostgresFlagRepository(pool, clock),
    keys,
    audit: createPostgresAuditLog(pool),
    uow: createPostgresUnitOfWork(pool, clock),
    exposures: createPostgresExposureRepository(pool),
    migrateAndSeed: async (adminApiKey, serverApiKeys) => {
      const lockClient = new Client({ connectionString: databaseUrl });
      await lockClient.connect();
      try {
        await migrate(createPostgresMigrationConnection(lockClient), POSTGRES_MIGRATIONS, () =>
          clock.now(),
        );
        await seedAdminKey(keys, adminApiKey, clock);
        await seedServerKeys(keys, serverApiKeys, clock);
      } finally {
        await lockClient.end();
      }
    },
  };
}

async function buildAdapters(config: CompositionConfig, clock: Clock): Promise<Adapters> {
  switch (config.databaseDriver) {
    case 'memory':
      return buildMemoryAdapters(clock);
    case 'sqlite':
      return buildSqliteAdapters(config.sqliteFile ?? 'feature-semaphore.sqlite', clock);
    case 'postgres':
      return buildPostgresAdapters(requireDatabaseUrl(config.databaseUrl), clock);
  }
}

/**
 * All routes — including `/api/v1` — are registered synchronously here,
 * before `buildApp` resolves, because Fastify locks its routing tree once the
 * instance boots (via `.ready()`/`.inject()`/`.listen()`); registering a
 * route afterward throws. Adapter construction (opening a connection) is
 * fast and happens before routes are wired. Only `migrate()` + `seedAdminKey`
 * run in the background: that is the real startup latency, and it is what
 * `/readyz` gates — not route registration.
 */
export async function buildApp(
  config: CompositionConfig,
  clock: Clock = createSystemClock(),
  loggerOverrides: ServerLoggerOverrides = {},
): Promise<Composition> {
  const app = Fastify({
    logger: createServerLogger(loggerOverrides),
    // Adopts the BFF's own request id (injected at `forward.ts:31`) so both
    // processes' logs correlate for the same browser request (design D4);
    // falls back to a fresh id for any request that arrives without one.
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      return typeof inbound === 'string' ? inbound : randomUUID();
    },
  });
  registerErrorHandler(app);

  let isReady = false;
  app.get('/healthz', (_request, reply: FastifyReply) => {
    reply.send({ status: 'ok' });
  });
  app.get('/readyz', (_request, reply: FastifyReply) => {
    if (!isReady) {
      reply.code(503).send({ status: 'not-ready' });
      return;
    }
    reply.send({ status: 'ready' });
  });

  const adapters = await buildAdapters(config, clock);

  const definitionsLatencyHistogram = createHistogram([
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
  ]);

  // Root scope — a SIBLING of `/healthz`/`/readyz`, registered before the
  // `/api/v1` scope below and therefore outside its `authPlugin` (design D6):
  // `/metrics` is unauthenticated by placement, exactly like `/healthz`. Two
  // absences carry the reachability guarantee, neither of them an auth
  // check: the server has no public IP (Fly private network only), and
  // `packages/bff/src/http/proxy/route-table.ts` has no `/metrics` row, so no
  // dashboard session can reach it either.
  registerMetricsRoutes(app, {
    repo: adapters.repo,
    exposures: adapters.exposures,
    clock,
    histogram: definitionsLatencyHistogram,
  });

  await app.register(
    (instance, _opts, done) => {
      authPlugin(instance, { keys: adapters.keys, clock });
      registerFlagsRoutes(instance, {
        uow: adapters.uow,
        repo: adapters.repo,
        audit: adapters.audit,
        clock,
      });
      registerConfigRoutes(instance, { uow: adapters.uow, clock });
      registerRulesRoutes(instance, { uow: adapters.uow, clock });
      registerOverridesRoutes(instance, { uow: adapters.uow, clock });
      registerEvaluateRoutes(instance, { repo: adapters.repo });
      registerExposuresRoutes(instance, { exposures: adapters.exposures, clock });
      done();
    },
    { prefix: '/api/v1' },
  );

  // A SIBLING Fastify scope, never nested inside `/api/v1` — Fastify hooks are
  // encapsulated per `register` scope, so the management `onRequest` hook
  // (admin-only) never runs against an SDK request, and vice versa.
  await app.register(
    (instance, _opts, done) => {
      sdkAuthPlugin(instance, { keys: adapters.keys, clock });
      registerSdkRoutes(instance, {
        repo: adapters.repo,
        exposures: adapters.exposures,
        clock,
        histogram: definitionsLatencyHistogram,
      });
      done();
    },
    { prefix: '/api/v1/sdk' },
  );

  const start = async (): Promise<void> => {
    await adapters.migrateAndSeed(config.adminApiKey, config.serverApiKeys ?? NO_SERVER_KEYS);
    isReady = true;
  };

  return { app, start };
}

function requireDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error('DATABASE_URL must be set for the postgres driver');
  return databaseUrl;
}
