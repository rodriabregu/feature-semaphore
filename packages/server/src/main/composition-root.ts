import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { AuditLog } from '../application/ports/audit-log.js';
import type { Clock } from '../application/ports/clock.js';
import type { ApiKeyRepository } from '../application/ports/api-key-repository.js';
import type { FlagRepository } from '../application/ports/flag-repository.js';
import type { UnitOfWork } from '../application/ports/unit-of-work.js';
import { createSystemClock } from '../infrastructure/clock/system-clock.js';
import { registerErrorHandler } from '../infrastructure/http/error-handler.js';
import { authPlugin } from '../infrastructure/http/plugins/auth.js';
import { sdkAuthPlugin } from '../infrastructure/http/plugins/sdk-auth.js';
import { registerConfigRoutes } from '../infrastructure/http/routes/config.routes.js';
import { registerFlagsRoutes } from '../infrastructure/http/routes/flags.routes.js';
import { registerOverridesRoutes } from '../infrastructure/http/routes/overrides.routes.js';
import { registerRulesRoutes } from '../infrastructure/http/routes/rules.routes.js';
import { registerSdkRoutes } from '../infrastructure/http/routes/sdk.routes.js';
import { createMemoryApiKeyRepository } from '../infrastructure/persistence/memory/api-key-repository.memory.js';
import { createMemoryAuditLog } from '../infrastructure/persistence/memory/audit-log.memory.js';
import { createMemoryFlagRepository } from '../infrastructure/persistence/memory/flag-repository.memory.js';
import { MemoryDatabase } from '../infrastructure/persistence/memory/store.js';
import { createMemoryUnitOfWork } from '../infrastructure/persistence/memory/unit-of-work.memory.js';
import {
  POSTGRES_MIGRATIONS,
  SQLITE_MIGRATIONS,
} from '../infrastructure/persistence/migrations/index.js';
import { migrate } from '../infrastructure/persistence/migrations/runner.js';
import { seedAdminKey } from '../infrastructure/persistence/seed/admin-key.js';

export type DatabaseDriver = 'memory' | 'sqlite' | 'postgres';

export interface CompositionConfig {
  readonly databaseDriver: DatabaseDriver;
  readonly adminApiKey: string | undefined;
  readonly databaseUrl?: string;
  readonly sqliteFile?: string;
}

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
  /** Runs migrations (a no-op for memory) then seeds the admin key. */
  readonly migrateAndSeed: (adminApiKey: string | undefined) => Promise<void>;
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
    // The memory adapter has no schema to migrate — only the admin-key seed applies.
    migrateAndSeed: (adminApiKey) => seedAdminKey(keys, adminApiKey, clock),
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

  const db = openSqliteDatabase(sqliteFile);
  const keys = createSqliteApiKeyRepository(db);

  return {
    repo: createSqliteFlagRepository(db, clock),
    keys,
    audit: createSqliteAuditLog(db),
    uow: createSqliteUnitOfWork(db, clock),
    migrateAndSeed: async (adminApiKey) => {
      await migrate(createSqliteMigrationConnection(db), SQLITE_MIGRATIONS, () => clock.now());
      await seedAdminKey(keys, adminApiKey, clock);
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

  const pool = new Pool({ connectionString: databaseUrl });
  const keys = createPostgresApiKeyRepository(pool);

  return {
    repo: createPostgresFlagRepository(pool, clock),
    keys,
    audit: createPostgresAuditLog(pool),
    uow: createPostgresUnitOfWork(pool, clock),
    migrateAndSeed: async (adminApiKey) => {
      const lockClient = new Client({ connectionString: databaseUrl });
      await lockClient.connect();
      try {
        await migrate(createPostgresMigrationConnection(lockClient), POSTGRES_MIGRATIONS, () =>
          clock.now(),
        );
        await seedAdminKey(keys, adminApiKey, clock);
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
): Promise<Composition> {
  const app = Fastify({ logger: false });
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
      registerSdkRoutes(instance, { repo: adapters.repo });
      done();
    },
    { prefix: '/api/v1/sdk' },
  );

  const start = async (): Promise<void> => {
    await adapters.migrateAndSeed(config.adminApiKey);
    isReady = true;
  };

  return { app, start };
}

function requireDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error('DATABASE_URL must be set for the postgres driver');
  return databaseUrl;
}
