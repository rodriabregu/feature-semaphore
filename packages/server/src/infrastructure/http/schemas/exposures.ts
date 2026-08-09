import { z } from 'zod';
import type { Clock } from '../../../application/ports/clock.js';
import { environmentSchema } from './environment.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One named, user-confirmed constant: 30 days is a settled decision, not a placeholder. */
export const MAX_LOOKBACK_MS = 30 * DAY_MS;

/**
 * A factory over the injected `Clock` — no `new Date()` inside the schema
 * itself — so a fake clock in tests makes every bound deterministic.
 * `.strict()` MUST be called on the base `z.object(...)` BEFORE
 * `.transform(...)`: the value `.transform()` returns exposes `.refine()`
 * but no `.strict()`, so this ordering is a real API constraint, not style.
 */
export function makeExposuresQuery(clock: Clock) {
  return z
    .object({ env: environmentSchema, since: z.coerce.date().optional() })
    .strict() // an unknown query param -> 400, matching auditQuery
    .transform((q) => ({
      env: q.env,
      since: q.since ?? new Date(clock.now().getTime() - DAY_MS),
    }))
    .refine((q) => q.since.getTime() <= clock.now().getTime(), {
      path: ['since'],
      message: 'since must not be in the future',
    })
    .refine((q) => clock.now().getTime() - q.since.getTime() <= MAX_LOOKBACK_MS, {
      path: ['since'],
      message: 'since exceeds the 30 day maximum lookback',
    });
}
