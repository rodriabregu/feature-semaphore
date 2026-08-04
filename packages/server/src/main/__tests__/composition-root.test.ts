import { describe, expect, it } from 'vitest';
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
});
