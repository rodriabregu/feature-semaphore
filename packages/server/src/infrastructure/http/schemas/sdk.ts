import { z } from 'zod';
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

/**
 * `.strict()` at both levels: no `environment` field (it comes only from the
 * key — a smuggled one is a 400, never silently accepted) and no timestamp
 * field (client time is untrusted; `bucket_hour` is server-derived). `reason`
 * is bounded in length but not enumerated — see the port's own comment.
 */
export const exposureEntryBody = z
  .object({
    flagKey: z.string().min(1).max(64),
    value: z.boolean(),
    reason: z.string().min(1).max(64),
    count: z.number().int().min(1).max(1_000_000),
  })
  .strict();

export const eventsBody = z
  .object({
    exposures: z.array(exposureEntryBody).min(1).max(500),
  })
  .strict();
