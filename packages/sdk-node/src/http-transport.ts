import type { Environment, FlagDefinition } from '@rodriab/feature-semaphore-core';
import type { DefinitionsResponse, ExposureRecord, Transport } from './ports/transport.js';

interface DefinitionsResponseBody {
  readonly environment: Environment;
  readonly definitions: readonly FlagDefinition[];
}

type FetchFn = typeof fetch;

export interface HttpTransportOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Injectable for tests; defaults to the real global `fetch` (Node >= 22). */
  readonly fetchFn?: FetchFn;
}

/**
 * The ONLY module naming `fetch`. No payload validation is performed here:
 * `evaluate()` is documented total for untrusted definition shapes, so
 * validating in the SDK would duplicate core's own defence and impose a
 * schema library on every consumer. A corrupt body simply fails `.json()`,
 * which throws — the poller's catch keeps the last good snapshot, closing
 * the "corrupt payload" scenario with no code here at all.
 */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  const fetchFn = options.fetchFn ?? fetch;
  const authHeader = { authorization: `Bearer ${options.apiKey}` };

  return {
    async fetchDefinitions(
      etag: string | undefined,
      signal: AbortSignal,
    ): Promise<DefinitionsResponse> {
      const headers: Record<string, string> = { ...authHeader };
      if (etag !== undefined) {
        headers['if-none-match'] = etag;
      }

      const response = await fetchFn(`${options.baseUrl}/api/v1/sdk/definitions`, {
        method: 'GET',
        headers,
        signal,
      });

      if (response.status === 304) {
        return { status: 304, etag: response.headers.get('etag') ?? etag };
      }
      if (response.status === 200) {
        const body = (await response.json()) as DefinitionsResponseBody;
        return {
          status: 200,
          etag: response.headers.get('etag') ?? undefined,
          environment: body.environment,
          definitions: body.definitions,
        };
      }

      throw new Error(`unexpected status fetching definitions: ${String(response.status)}`);
    },

    async sendExposures(rows: readonly ExposureRecord[], signal: AbortSignal): Promise<void> {
      const response = await fetchFn(`${options.baseUrl}/api/v1/sdk/events`, {
        method: 'POST',
        headers: { ...authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ exposures: rows }),
        signal,
      });

      if (response.status !== 202) {
        throw new Error(`unexpected status sending exposures: ${String(response.status)}`);
      }
    },
  };
}
