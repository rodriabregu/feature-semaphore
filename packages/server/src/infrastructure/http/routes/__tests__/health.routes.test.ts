import { describe, expect, it } from 'vitest';
import { buildApp } from '../../../../main/composition-root.js';

describe('health routes', () => {
  it('GET /healthz and GET /readyz are unauthenticated and outside /api/v1', async () => {
    const { app, start } = await buildApp({
      databaseDriver: 'memory',
      adminApiKey: `fs_admin_${'a'.repeat(43)}`,
    });
    await start();

    const health = await app.inject({ method: 'GET', url: '/healthz' });
    const ready = await app.inject({ method: 'GET', url: '/readyz' });

    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
  });
});
