import { describe, expect, it, vi } from 'vitest';
import { MalformedServerApiKeyError } from '../../infrastructure/persistence/seed/server-key.js';
import { buildApp } from '../composition-root.js';

describe('composition root', () => {
  it('/readyz returns 503 before start() completes and 200 after', async () => {
    const { app, start } = await buildApp({
      databaseDriver: 'memory',
      adminApiKey: `fs_admin_${'a'.repeat(43)}`,
    });

    const before = await app.inject({ method: 'GET', url: '/readyz' });
    expect(before.statusCode).toBe(503);

    await start();

    const after = await app.inject({ method: 'GET', url: '/readyz' });
    expect(after.statusCode).toBe(200);
  });

  it('/healthz is always 200, unauthenticated', async () => {
    const { app } = await buildApp({
      databaseDriver: 'memory',
      adminApiKey: `fs_admin_${'a'.repeat(43)}`,
    });
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
  });

  it('DATABASE_DRIVER=memory connects no pg or better-sqlite3 — start() completes without a database file or URL configured', async () => {
    const { start } = await buildApp({
      databaseDriver: 'memory',
      adminApiKey: `fs_admin_${'a'.repeat(43)}`,
      // Deliberately no databaseUrl / sqliteFile — a real driver would need one.
    });

    await expect(start()).resolves.toBeUndefined();
  });

  it('start() fails when ADMIN_API_KEY is unset', async () => {
    const { start } = await buildApp({ databaseDriver: 'memory', adminApiKey: undefined });
    await expect(start()).rejects.toThrow();
  });

  it('row 39: SERVER_API_KEY_DEVELOPMENT set, _PRODUCTION unset -> process starts, the development key is usable, no production server key exists', async () => {
    const rawDevKey = `fs_server_${'d'.repeat(43)}`;
    const { app, start } = await buildApp({
      databaseDriver: 'memory',
      adminApiKey: `fs_admin_${'a'.repeat(43)}`,
      serverApiKeys: { development: rawDevKey, production: undefined },
    });

    await expect(start()).resolves.toBeUndefined();

    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);

    const devResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: { authorization: `Bearer ${rawDevKey}` },
    });
    expect(devResponse.statusCode).toBe(200);

    // No production server key exists: an unregistered production-shaped
    // token is unauthenticated, not merely unauthorized-for-scope.
    const unregisteredProdKey = `fs_server_${'e'.repeat(43)}`;
    const prodResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/definitions',
      headers: { authorization: `Bearer ${unregisteredProdKey}` },
    });
    expect(prodResponse.statusCode).toBe(401);
  });

  it('row 33: GET /api/v1/exposures with an admin key returns 200 on the real composition root — the management scope really resolves adapters.exposures', async () => {
    const adminKey = `fs_admin_${'a'.repeat(43)}`;
    const { app, start } = await buildApp({ databaseDriver: 'memory', adminApiKey: adminKey });
    await start();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/exposures?env=development',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('row 39: a malformed SERVER_API_KEY_PRODUCTION fails startup with a named error, never logged', async () => {
    const rawMalformed = 'not-a-real-shape';
    const { start } = await buildApp({
      databaseDriver: 'memory',
      adminApiKey: `fs_admin_${'a'.repeat(43)}`,
      serverApiKeys: { development: undefined, production: rawMalformed },
    });

    const captured: unknown[] = [];
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      captured.push(args);
    });

    let caught: unknown;
    try {
      // Mirrors main/index.ts's own catch-and-log shape exactly.
      await start().catch((error: unknown) => {
        console.error('Fatal startup error:', error);
        throw error;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MalformedServerApiKeyError);
    expect(JSON.stringify(captured)).not.toContain(rawMalformed);

    consoleSpy.mockRestore();
  });
});
