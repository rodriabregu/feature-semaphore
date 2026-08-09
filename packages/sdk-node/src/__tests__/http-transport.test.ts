import { describe, expect, it } from 'vitest';
import { createHttpTransport } from '../http-transport.js';

interface FakeResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

function fakeResponse(
  status: number,
  headers: Record<string, string>,
  body: unknown,
): FakeResponse {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  };
}

describe('createHttpTransport', () => {
  it('row 36: a non-200/304 status throws', async () => {
    const fetchFn = (() => Promise.resolve(fakeResponse(500, {}, {}))) as unknown as typeof fetch;
    const transport = createHttpTransport({ baseUrl: 'http://x', apiKey: 'key', fetchFn });

    await expect(
      transport.fetchDefinitions(undefined, new AbortController().signal),
    ).rejects.toThrow();
  });

  it('row 36: a 304 yields no definitions field', async () => {
    const fetchFn = (() =>
      Promise.resolve(fakeResponse(304, { etag: '"abc"' }, undefined))) as unknown as typeof fetch;
    const transport = createHttpTransport({ baseUrl: 'http://x', apiKey: 'key', fetchFn });

    const response = await transport.fetchDefinitions('"abc"', new AbortController().signal);

    expect(response.status).toBe(304);
    expect(Object.hasOwn(response, 'definitions')).toBe(false);
  });

  it('a 200 yields the parsed environment and definitions', async () => {
    const body = { environment: 'development', definitions: [] };
    const fetchFn = (() =>
      Promise.resolve(fakeResponse(200, { etag: '"xyz"' }, body))) as unknown as typeof fetch;
    const transport = createHttpTransport({ baseUrl: 'http://x', apiKey: 'key', fetchFn });

    const response = await transport.fetchDefinitions(undefined, new AbortController().signal);

    expect(response).toEqual({
      status: 200,
      etag: '"xyz"',
      environment: 'development',
      definitions: [],
    });
  });

  it('sendExposures throws on a non-202 status', async () => {
    const fetchFn = (() => Promise.resolve(fakeResponse(500, {}, {}))) as unknown as typeof fetch;
    const transport = createHttpTransport({ baseUrl: 'http://x', apiKey: 'key', fetchFn });

    await expect(transport.sendExposures([], new AbortController().signal)).rejects.toThrow();
  });

  it('sendExposures resolves on a 202', async () => {
    const fetchFn = (() =>
      Promise.resolve(fakeResponse(202, {}, undefined))) as unknown as typeof fetch;
    const transport = createHttpTransport({ baseUrl: 'http://x', apiKey: 'key', fetchFn });

    await expect(
      transport.sendExposures([], new AbortController().signal),
    ).resolves.toBeUndefined();
  });
});
