export type Cancel = () => void;

/**
 * An abstraction over `setInterval`, chosen over injecting fake timers
 * directly: a fake `Scheduler` that invokes `fn()` synchronously turns every
 * polling/flush test into a straight-line synchronous assertion with zero
 * timer machinery, and confines `unref()` to one small adapter
 * (`timers-scheduler.ts`) instead of spreading fake-timer semantics across
 * every test that touches time.
 */
export interface Scheduler {
  every(ms: number, fn: () => void): Cancel;
}
