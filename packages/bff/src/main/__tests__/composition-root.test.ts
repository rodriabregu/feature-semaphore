import { describe, expect, it } from 'vitest';
import { buildApp } from '../composition-root.js';

const VALID_CONFIG = {
  upstreamUrl: 'http://localhost:3000',
  adminApiKey: `fs_admin_${'a'.repeat(43)}`,
  dashboardPassword: 'correct-horse-battery-staple',
  cookieSecure: true,
};

describe('composition root', () => {
  it('/healthz is always 200, before and after start()', async () => {
    const { app } = await buildApp(VALID_CONFIG);

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
  });

  it('/readyz returns 503 before start() resolves and 200 after', async () => {
    const { app, start } = await buildApp(VALID_CONFIG);

    const before = await app.inject({ method: 'GET', url: '/readyz' });
    expect(before.statusCode).toBe(503);

    await start();

    const after = await app.inject({ method: 'GET', url: '/readyz' });
    expect(after.statusCode).toBe(200);
  });
});
