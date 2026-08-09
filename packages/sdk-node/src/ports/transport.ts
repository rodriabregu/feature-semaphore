import type { Environment, FlagDefinition } from '@rodriab/feature-semaphore-core';

export interface DefinitionsFetched {
  readonly status: 200;
  readonly etag: string | undefined;
  readonly environment: Environment;
  readonly definitions: readonly FlagDefinition[];
}

export interface DefinitionsNotModified {
  readonly status: 304;
  readonly etag: string | undefined;
}

export type DefinitionsResponse = DefinitionsFetched | DefinitionsNotModified;

export interface ExposureRecord {
  readonly flagKey: string;
  readonly value: boolean;
  readonly reason: string;
  readonly count: number;
}

export interface Transport {
  /** Anything other than 200/304 (network error, 4xx, 5xx) THROWS. */
  fetchDefinitions(etag: string | undefined, signal: AbortSignal): Promise<DefinitionsResponse>;
  sendExposures(rows: readonly ExposureRecord[], signal: AbortSignal): Promise<void>;
}
