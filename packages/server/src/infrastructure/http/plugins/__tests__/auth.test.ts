import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryApiKeyRepository } from '../../../persistence/memory/api-key-repository.memory.js';
import { MemoryDatabase } from '../../../persistence/memory/store.js';
import { registerErrorHandler } from '../../error-handler.js';
import { authPlugin } from '../auth.js';

const ADMIN_KEY = `fs_admin_${'a'.repeat(43)}`;
const SERVER_KEY = `fs_server_${'b'.repeat(43)}`;

function hash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

async function buildApp(clock: { now: () => Date }, touchCalls: string[]) {
  const db = new MemoryDatabase();
  const store = { get: () => db.current };
  const keys = createMemoryApiKeyRepository(store);
  await keys.ensureAdminKey(hash(ADMIN_KEY), clock.now());
  db.current.apiKeys.push({
    id: randomUUID(),
    kind: 'server',
    environment: 'development',
    keyHash: hash(SERVER_KEY),
    createdAt: clock.now(),
    lastUsedAt: null,
  });

  const originalTouch = keys.touch.bind(keys);
  const wrappedKeys = {
    ...keys,
    touch: async (id: string, at: Date, staleBefore: Date) => {
      touchCalls.push(id);
      await originalTouch(id, at, staleBefore);
    },
  };

  const app = Fastify();
  registerErrorHandler(app);
  await app.register(
    (instance, _opts, done) => {
      authPlugin(instance, { keys: wrappedKeys, clock });
      instance.get('/protected', (_request, reply) => {
        reply.send({ ok: true });
      });
      done();
    },
    { prefix: '/api/v1' },
  );
  return app;
}

describe('auth plugin', () => {
  let clock: { now: () => Date };

  beforeEach(() => {
    clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  });

  it('no Authorization header -> 401 problem+json with WWW-Authenticate: Bearer', async () => {
    const app = await buildApp(clock, []);
    const response = await app.inject({ method: 'GET', url: '/api/v1/protected' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('a valid server-kind key on a management route -> 403 forbidden_kind', async () => {
    const app = await buildApp(clock, []);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { authorization: `Bearer ${SERVER_KEY}` },
    });

    expect(response.statusCode).toBe(403);
    const body: { type: string } = response.json();
    expect(body.type).toContain('forbidden-kind');
  });

  it('an admin key reaches the route successfully — not environment-scoped', async () => {
    const app = await buildApp(clock, []);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('malformed and unknown tokens produce byte-identical 401 bodies', async () => {
    const app = await buildApp(clock, []);
    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { authorization: 'Bearer not-a-real-shape' },
    });
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { authorization: `Bearer fs_admin_${'z'.repeat(43)}` },
    });

    expect(malformed.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(malformed.body).toBe(unknown.body);
  });

  it('two requests inside the 60s window call touch exactly once', async () => {
    const touchCalls: string[] = [];
    const app = await buildApp(clock, touchCalls);

    await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    });

    expect(touchCalls).toHaveLength(1);
  });
});
