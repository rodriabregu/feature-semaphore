import type { Delay } from '../../ports/delay.js';

/**
 * `[I]` Invented — no repo precedent for the magnitude. Named constants, in
 * the `packages/server/src/infrastructure/http/schemas/exposures.ts:7-8`
 * comment style: unconfirmed, trivially revisable.
 */
export const BASE_DELAY_MS = 250;
export const MAX_DELAY_MS = 2_000;

/** delayFor(0) = 0; 1 -> 250; 2 -> 500; 3 -> 1000; 4+ -> 2000 (cap). */
export function delayFor(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (consecutiveFailures - 1), MAX_DELAY_MS);
}

export interface LoginThrottle {
  /**
   * Runs `verify`, delays per the pinned evaluation order below, and returns
   * whether the attempt succeeded. NEVER refuses a correct password — it
   * only ever delays.
   */
  attempt(verify: () => boolean): Promise<boolean>;
}

/**
 * ONE counter, global to the BFF instance — never keyed by client IP or any
 * other client-supplied identity (`#1894` MUST). Exactly one credential
 * exists system-wide, so a per-IP counter is evaded by rotating source
 * addresses, collaterally slows an operator behind a shared NAT, and is an
 * unbounded Map keyed by attacker-controlled data. Structurally the same
 * in-memory counter as
 * `packages/server/src/infrastructure/http/plugins/token-auth.ts:62-70`.
 *
 * NO CLOCK IS USED. There is no time-decay window: the counter resets only
 * on a successful login, so escalation is pure state and deterministic by
 * construction. The injected seam is the `Delay`, not a `Clock`.
 *
 * NO DENIAL STATE EXISTS. A correct password always succeeds — delayed,
 * never refused. `too_many_attempts` is dropped; there is no 429 path here.
 *
 * Evaluation order — pinned, because three of five spec scenarios
 * discriminate between orderings (design Part 1 §3):
 *
 *   1. pending := counter                     // state BEFORE this attempt
 *   2. verify (constant-time)
 *   3. correct -> delay := delayFor(pending);  counter := 0
 *      wrong   -> counter := pending + 1;      delay := delayFor(counter)
 *   4. await delay.wait(delay)                 // non-blocking
 *   5. respond — 200 + cookie, or a plain 401
 */
export function createLoginThrottle(delay: Delay): LoginThrottle {
  let counter = 0;

  return {
    async attempt(verify: () => boolean): Promise<boolean> {
      const pending = counter;
      const correct = verify();

      let ms: number;
      if (correct) {
        ms = delayFor(pending);
        counter = 0;
      } else {
        counter = pending + 1;
        ms = delayFor(counter);
      }

      await delay.wait(ms);
      return correct;
    },
  };
}
