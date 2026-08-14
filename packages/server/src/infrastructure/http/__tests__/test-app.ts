import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Clock } from '../../../application/ports/clock.js';
import type { ExposureRepository } from '../../../application/ports/exposure-repository.js';
import type { UnitOfWork } from '../../../application/ports/unit-of-work.js';
import { createMemoryApiKeyRepository } from '../../persistence/memory/api-key-repository.memory.js';
import { createMemoryAuditLog } from '../../persistence/memory/audit-log.memory.js';
import { createMemoryExposureRepository } from '../../persistence/memory/exposure-repository.memory.js';
import { createMemoryFlagRepository } from '../../persistence/memory/flag-repository.memory.js';
import { MemoryDatabase } from '../../persistence/memory/store.js';
import { createMemoryUnitOfWork } from '../../persistence/memory/unit-of-work.memory.js';
import { createHistogram } from '../metrics/histogram.js';
import { registerErrorHandler } from '../error-handler.js';
import { authPlugin } from '../plugins/auth.js';
import { sdkAuthPlugin } from '../plugins/sdk-auth.js';
import { registerConfigRoutes } from '../routes/config.routes.js';
import { registerEvaluateRoutes } from '../routes/evaluate.routes.js';
import { registerExposuresRoutes } from '../routes/exposures.routes.js';
import { registerFlagsRoutes } from '../routes/flags.routes.js';
import { registerOverridesRoutes } from '../routes/overrides.routes.js';
import { registerRulesRoutes } from '../routes/rules.routes.js';
import { registerSdkRoutes } from '../routes/sdk.routes.js';

export const ADMIN_KEY = `fs_admin_${'a'.repeat(43)}`;
export const SERVER_KEY = `fs_server_${'b'.repeat(43)}`;
export const PRODUCTION_SERVER_KEY = `fs_server_${'c'.repeat(43)}`;

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export interface TestApp {
  readonly app: FastifyInstance;
  readonly db: MemoryDatabase;
  readonly clock: Clock;
}

export interface BuildTestAppOptions {
  /**
   * Override the wired `UnitOfWork` — e.g. to simulate a failing audit write
   * for a specific mutation while everything else behaves normally. Receives
   * the same `db`/`clock` the rest of the app is built against.
   */
  readonly uowFactory?: (db: MemoryDatabase, clock: Clock) => UnitOfWork;

  /**
   * Override the wired `ExposureRepository` — e.g. to simulate a persistence
   * failure on `POST /api/v1/sdk/events` while everything else behaves
   * normally.
   */
  readonly exposuresFactory?: (store: {
    get: () => MemoryDatabase['current'];
  }) => ExposureRepository;

  /**
   * A writable sink for the app's logger — e.g. to assert a persistence
   * failure was logged, not silently swallowed. Defaults to a disabled
   * logger DELIBERATELY: the composition root now logs for real (S1), so a
   * test that does not assert on log output should stay quiet rather than
   * mirror production's logger. Typed to pino's minimal destination shape,
   * not the full `NodeJS.WritableStream`.
   */
  readonly logStream?: { write(chunk: string): boolean };
}

/** A full app wired against the in-memory adapter — no network, no Docker. */
export async function buildTestApp(options: BuildTestAppOptions = {}): Promise<TestApp> {
  const db = new MemoryDatabase();
  const store = { get: () => db.current };
  const clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };

  const repo = createMemoryFlagRepository(store, clock);
  const keys = createMemoryApiKeyRepository(store);
  const audit = createMemoryAuditLog(store);
  const exposures = options.exposuresFactory
    ? options.exposuresFactory(store)
    : createMemoryExposureRepository(store);
  const uow = options.uowFactory
    ? options.uowFactory(db, clock)
    : createMemoryUnitOfWork(db, clock);

  await keys.ensureAdminKey(hashKey(ADMIN_KEY), clock.now());
  db.current.apiKeys.push({
    id: randomUUID(),
    kind: 'server',
    environment: 'development',
    keyHash: hashKey(SERVER_KEY),
    createdAt: clock.now(),
    lastUsedAt: null,
  });
  db.current.apiKeys.push({
    id: randomUUID(),
    kind: 'server',
    environment: 'production',
    keyHash: hashKey(PRODUCTION_SERVER_KEY),
    createdAt: clock.now(),
    lastUsedAt: null,
  });

  const app = options.logStream
    ? Fastify({ logger: { level: 'error', stream: options.logStream } })
    : Fastify();
  registerErrorHandler(app);
  await app.register(
    (instance, _opts, done) => {
      authPlugin(instance, { keys, clock });
      registerFlagsRoutes(instance, { uow, repo, audit, clock });
      registerConfigRoutes(instance, { uow, clock });
      registerRulesRoutes(instance, { uow, clock });
      registerOverridesRoutes(instance, { uow, clock });
      registerEvaluateRoutes(instance, { repo });
      registerExposuresRoutes(instance, { exposures, clock });
      done();
    },
    { prefix: '/api/v1' },
  );

  // SIBLING scope, never nested inside `/api/v1` — see `main/composition-root.ts`.
  await app.register(
    (instance, _opts, done) => {
      sdkAuthPlugin(instance, { keys, clock });
      registerSdkRoutes(instance, {
        repo,
        exposures,
        clock,
        histogram: createHistogram([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]),
      });
      done();
    },
    { prefix: '/api/v1/sdk' },
  );

  return { app, db, clock };
}

export function adminAuthHeader(): Record<string, string> {
  return { authorization: `Bearer ${ADMIN_KEY}` };
}

export function serverAuthHeader(): Record<string, string> {
  return { authorization: `Bearer ${SERVER_KEY}` };
}

export function productionServerAuthHeader(): Record<string, string> {
  return { authorization: `Bearer ${PRODUCTION_SERVER_KEY}` };
}
