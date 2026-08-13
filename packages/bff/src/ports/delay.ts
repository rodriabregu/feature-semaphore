/**
 * An abstraction over `setTimeout`, chosen over a fake-timer library for the
 * same reason `packages/sdk-node/src/ports/scheduler.ts:3-10` chose one over
 * injecting fake timers: a fake `Delay` that records the requested ms and
 * resolves immediately turns every escalation assertion into a straight-line
 * synchronous check with zero timer machinery — and zero wall-clock cost,
 * which matters because row 15 exercises 20 consecutive failures.
 */
export interface Delay {
  wait(ms: number): Promise<void>;
}
