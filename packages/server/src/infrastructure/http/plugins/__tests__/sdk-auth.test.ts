import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryApiKeyRepository } from '../../../persistence/memory/api-key-repository.memory.js';
import { MemoryDatabase } from '../../../persistence/memory/store.js';
import { registerErrorHandler } from '../../error-handler.js';
import { sdkAuthPlugin } from '../sdk-auth.js';

const ADMIN_KEY = `fs_admin_${'a'.repeat(43)}`;
const SERVER_KEY = `fs_server_${'b'.repeat(43)}`;

function hash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

interface BuildOptions {
  readonly serverEnvironment?: 'development' | 'production' | null;
}

async function buildApp(clock: { now: () => Date }, options: BuildOptions = {}) {
  const db = new MemoryDatabase();
  const store = { get: () => db.current };
  const keys = createMemoryApiKeyRepository(store);
  await keys.ensureAdminKey(hash(ADMIN_KEY), clock.now());

  const environment =
    options.serverEnvironment === undefined ? 'development' : options.serverEnvironment;
  db.current.apiKeys.push({
    id: randomUUID(),
    kind: 'server',
    environment,
    keyHash: hash(SERVER_KEY),
    createdAt: clock.now(),
    lastUsedAt: null,
  });

  const app = Fastify();
  registerErrorHandler(app);
  await app.register(
    (instance, _opts, done) => {
      sdkAuthPlugin(instance, { keys, clock });
      instance.get('/protected', (request, reply) => {
        reply.send({ ok: true, environment: request.sdkAuth?.environment });
      });
      done();
    },
    { prefix: '/api/v1/sdk' },
  );
  return app;
}

describe('sdk auth plugin', () => {
  let clock: { now: () => Date };

  beforeEach(() => {
    clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  });

  it('an admin key on an SDK route -> 403 forbidden_kind', async () => {
    const app = await buildApp(clock);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/protected',
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    });

    expect(response.statusCode).toBe(403);
    const body: { type: string } = response.json();
    expect(body.type).toContain('forbidden-kind');
  });

  it('a server key reaches the route with request.sdkAuth.environment set', async () => {
    const app = await buildApp(clock);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/protected',
      headers: { authorization: `Bearer ${SERVER_KEY}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, environment: 'development' });
  });

  it('malformed and unknown tokens on the SDK scope produce byte-identical 401 bodies', async () => {
    const app = await buildApp(clock);
    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/protected',
      headers: { authorization: 'Bearer not-a-real-shape' },
    });
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/protected',
      headers: { authorization: `Bearer fs_server_${'z'.repeat(43)}` },
    });

    expect(malformed.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(malformed.body).toBe(unknown.body);
    expect(malformed.headers['www-authenticate']).toBe('Bearer');
  });

  it('a server key whose record has environment: null -> 500, and the body names no environment', async () => {
    const app = await buildApp(clock, { serverEnvironment: null });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/protected',
      headers: { authorization: `Bearer ${SERVER_KEY}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('development');
    expect(response.body).not.toContain('production');
  });
});
