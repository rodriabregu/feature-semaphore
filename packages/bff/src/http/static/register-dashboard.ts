import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

export interface RegisterDashboardDeps {
  readonly distDir: string;
}

/**
 * Serves the built dashboard bundle at root (design D2). `wildcard: false`
 * is the load-bearing setting here, not a tuning knob: with it,
 * `@fastify/static` globs `distDir` at registration time and creates one
 * concrete route per file, so it never registers the plugin's default
 * catch-all `GET {prefix}*` — which, at `prefix: '/'`, would match
 * `/api/nope` and swallow the scoped `/api` 404 before it ever fires
 * (verified against the plugin's own docs, `#1984`; decided empirically by
 * T3.2). Cost: a rebuild that changes asset filenames needs a BFF restart,
 * because unseen filenames were never globbed (design D8).
 *
 * The root `setNotFoundHandler` below is the SPA fallback for every path
 * this glob did not already claim. `sendFile('index.html')` is called with
 * a LITERAL, never anything derived from `request.url` (design §10's
 * path-traversal row) — with `wildcard: false` no request-derived path
 * reaches the filesystem at all, so this is belt-and-suspenders on top of a
 * structural defence, not the defence itself. Only `GET`/`HEAD` receive the
 * shell; every other method gets a plain 404, so an unknown mutation is
 * never answered with a 200 HTML page.
 */
export function registerDashboard(app: FastifyInstance, deps: RegisterDashboardDeps): void {
  void app.register(fastifyStatic, {
    root: deps.distDir,
    prefix: '/',
    wildcard: false,
    index: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      reply.code(404).send();
      return;
    }
    void reply.sendFile('index.html');
  });
}
