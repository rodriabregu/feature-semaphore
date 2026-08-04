import type { CompositionConfig } from './composition-root.js';
import { buildApp } from './composition-root.js';

export interface ServerOptions {
  readonly port: number;
  readonly host: string;
}

/**
 * Binds the listening socket FIRST, then runs the startup sequence (migrate
 * -> seed -> release lock -> flip readiness). The socket is bound early on
 * purpose: `/healthz` (liveness) must answer 200 immediately, while
 * `/readyz` (readiness) correctly answers 503 until `start()` resolves — the
 * standard liveness-vs-readiness split an orchestrator relies on to withhold
 * traffic during the migration window, per the design's own rollout note.
 */
export async function startServer(
  config: CompositionConfig,
  options: ServerOptions,
): Promise<void> {
  const { app, start } = await buildApp(config);
  await app.listen({ port: options.port, host: options.host });
  await start();
}
