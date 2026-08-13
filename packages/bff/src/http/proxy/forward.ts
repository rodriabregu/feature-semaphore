import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendBffProblem } from '../problem.js';
import type { ProxyDeps } from './register-proxy.js';

/**
 * Fidelity is authoritative here (design Part 1 §4, Part 2 §10.3): exactly
 * two request headers pass through (plus the injected `Authorization`),
 * exactly two response headers pass through, and the body travels
 * byte-for-byte in both directions. `If-Match` is never synthesised — absent
 * means absent, and the upstream's own 428 reaches the browser unmodified.
 */
const REQUEST_HEADER_ALLOW = ['if-match', 'content-type'] as const;
const RESPONSE_HEADER_ALLOW = ['etag', 'content-type'] as const;

/**
 * The single implementation of the proxy's fidelity rules — every route in
 * `PROXY_ROUTES` forwards through this one function. `register-proxy.ts`'s
 * B3a placeholder `forwardToUpstream` had none of these guarantees.
 */
export async function forward(
  deps: ProxyDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // RAW suffix, never rebuilt from `request.params` — re-templating decodes
  // then re-encodes, which can normalise `%2F` into `/` and change the
  // matched upstream route. Fastify already matched the raw path against a
  // fixed pattern, so the matched route IS the validation (row 39).
  const url = `${deps.upstreamUrl}/api/v1${request.url.slice('/api'.length)}`;

  const headers: Record<string, string> = { authorization: `Bearer ${deps.adminApiKey}` };
  for (const name of REQUEST_HEADER_ALLOW) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value; // If-Match VERBATIM, never synthesised
  }

  // GET/HEAD carry no body; every other method's body was captured raw by
  // register-proxy.ts's `'*'` content-type parser — byte-for-byte, never
  // parsed or re-serialised (row 33's outbound content-type comes along for
  // free since it is itself in the request allow-list).
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const rawBody = hasBody ? (request.body as Buffer | undefined) : undefined;
  // A cast, not a copy: `Buffer` is structurally a `Uint8Array` at runtime,
  // but two different ambient `fetch` typings are in scope here (the
  // implicit DOM lib pulled in by `target: ES2022` with no explicit `lib`,
  // and `@types/node`'s undici-based one) and neither's `BodyInit` alias
  // resolves `Buffer<ArrayBufferLike>` structurally. `unknown` is the only
  // honest bridge between them.
  const body = rawBody as unknown as BodyInit | undefined;

  let upstream: Response;
  try {
    upstream = await deps.fetchFn(url, { method: request.method, headers, body });
  } catch (error) {
    request.log.error({ err: error }, 'proxy: upstream unavailable');
    await sendBffProblem(reply, 'upstream_unavailable', request.url);
    return;
  }

  for (const name of RESPONSE_HEADER_ALLOW) {
    const value = upstream.headers.get(name);
    if (value !== null) reply.header(name, value);
  }

  // Byte-for-byte: never parsed, never re-serialised, so a 412's
  // expectedVersion/actualVersion survive unchanged (row 37).
  const buf = Buffer.from(await upstream.arrayBuffer());
  reply.code(upstream.status).send(buf);
}
