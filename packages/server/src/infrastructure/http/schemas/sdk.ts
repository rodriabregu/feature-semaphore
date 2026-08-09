import type { Environment, FlagDefinition } from '@rodriab/feature-semaphore-core';

/**
 * Wire shape of `GET /api/v1/sdk/definitions`'s 200 body. `definitions` is
 * `FlagDefinition` verbatim — no wire mapper. Introducing one here would
 * create a translation layer that can diverge from `core`, which is the one
 * thing ADR-05 forbids. The ETag lives in the `ETag` header, never in this
 * body, so a hand-edited bootstrap payload can never carry a stale ETag.
 */
export interface SdkDefinitionsResponse {
  readonly environment: Environment;
  readonly definitions: readonly FlagDefinition[];
}
