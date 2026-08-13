import type { CompositionConfig } from './composition-root.js';
import { buildApp } from './composition-root.js';

export interface ServerOptions {
  readonly port: number;
  readonly host: string;
}

/**
 * Binds the listening socket FIRST, then flips readiness — the same
 * liveness-vs-readiness split as `packages/server/src/main/server.ts`:
 * `/healthz` must answer 200 immediately, while `/readyz` correctly answers
 * 503 until `start()` resolves.
 */
export async function startServer(
  config: CompositionConfig,
  options: ServerOptions,
): Promise<void> {
  const { app, start } = await buildApp(config);
  await app.listen({ port: options.port, host: options.host });
  await start();
}
