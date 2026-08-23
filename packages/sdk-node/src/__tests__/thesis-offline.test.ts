import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { FlagDefinition } from '@rodriab/feature-semaphore-core';
import { createClient, type FlagsClient } from '../index.js';

/**
 * The project's central thesis, asserted end-to-end: **with the server off, an
 * application using the SDK keeps working on its own defaults.**
 *
 * `client.test.ts` rows 24/25a/25b already prove the same behaviour, but they
 * prove it against an injected fake `Transport` — a test that a rejected
 * promise is handled, not a test that an unreachable server is survivable.
 * This file deliberately injects NOTHING: no transport, no scheduler, no
 * clock. It calls the published entry point (`../index.js`) with only
 * `baseUrl` + `apiKey`, so the real `createHttpTransport`, the real global
 * `fetch`, and the real `setInterval` scheduler all take part, against a real
 * TCP port with nothing listening on it. Same reasoning as the BFF's
 * redaction tests: the claim is only proven through the production wiring.
 *
 * Real timers are used on purpose — a fake scheduler would remove the very
 * thing under test. The waits are sized in tens of milliseconds against a
 * 20ms poll interval, so several refresh attempts genuinely fail during each
 * test rather than being simulated.
 */

const CHECKOUT_FLAG: FlagDefinition = {
  key: 'checkout-v2',
  environment: 'development',
  archived: false,
  enabled: true,
  onValue: true,
  offValue: false,
  rollout: 0,
  salt: 'salt-1',
  rules: [],
  overrides: { 'unit-1': true },
};

/** Shaped exactly like `GET /api/v1/sdk/definitions`'s real response body. */
function startDefinitionsServer(): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url === '/api/v1/sdk/definitions') {
      response.writeHead(200, { 'content-type': 'application/json', etag: '"v1"' });
      response.end(JSON.stringify({ environment: 'development', definitions: [CHECKOUT_FLAG] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

/**
 * `closeAllConnections()` is load-bearing: `fetch`'s keep-alive agent holds
 * the socket open, and a plain `close()` would wait for it instead of making
 * the port refuse connections, which is the state the test needs.
 */
function stop(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Binds an ephemeral port and releases it, yielding a port nothing listens on. */
async function reserveThenReleasePort(): Promise<number> {
  const server = await startDefinitionsServer();
  const port = portOf(server);
  await stop(server);
  return port;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('the central thesis: the SDK survives the server being off', () => {
  let client: FlagsClient | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
    if (server) {
      await stop(server);
      server = undefined;
    }
  });

  it('with the server never reachable, an app keeps working on its caller defaults', async () => {
    const deadPort = await reserveThenReleasePort();
    client = createClient({
      baseUrl: `http://127.0.0.1:${String(deadPort)}`,
      apiKey: 'unused-nothing-is-listening',
      pollIntervalMs: 20,
      readyTimeoutMs: 100,
    });

    // ready() resolves on its timeout, never rejects, and never blocks boot.
    await expect(client.ready()).resolves.toBeUndefined();
    await wait(60); // several real refresh attempts fail against the closed port

    // The caller's default is what the app gets — both ways round, so this
    // cannot pass by accident on a hardcoded true.
    expect(client.isEnabled('checkout-v2', { unitId: 'unit-1' }, true)).toBe(true);
    expect(client.isEnabled('checkout-v2', { unitId: 'unit-1' }, false)).toBe(false);
    expect(client.getEvaluation('checkout-v2', { unitId: 'unit-1' }, true)).toEqual({
      value: true,
      reason: 'FLAG_NOT_FOUND',
    });

    // Shutdown also survives the server being gone: the exposure flush fails
    // against the same closed port and close() still resolves.
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('a server that dies mid-flight leaves the last known values in place, not the defaults', async () => {
    server = await startDefinitionsServer();
    client = createClient({
      baseUrl: `http://127.0.0.1:${String(portOf(server))}`,
      apiKey: 'demo-key',
      pollIntervalMs: 20,
      readyTimeoutMs: 4000,
    });

    await client.ready();
    // The caller default is false, so only real data off the wire can make
    // this true — this asserts the fetch actually happened.
    expect(client.isEnabled('checkout-v2', { unitId: 'unit-1' }, false)).toBe(true);

    await stop(server);
    server = undefined;
    await wait(80); // several real refresh attempts now fail

    // stale-while-revalidate: the served value is retained, NOT blanked back
    // to the caller default. Losing the server must not flip live traffic.
    expect(client.isEnabled('checkout-v2', { unitId: 'unit-1' }, false)).toBe(true);
  });
});
