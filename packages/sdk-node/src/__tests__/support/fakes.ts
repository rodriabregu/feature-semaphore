import type { Cancel, Scheduler } from '../../ports/scheduler.js';

/**
 * A fully synchronous fake: `.every()` registers a callback but never fires
 * it on its own — the test controls exactly when a "tick" happens via
 * `.tick()`, invoked synchronously with zero timer machinery.
 */
export class FakeScheduler implements Scheduler {
  readonly #entries: { fn: () => void; cancelled: boolean }[] = [];

  every(_ms: number, fn: () => void): Cancel {
    const entry = { fn, cancelled: false };
    this.#entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  /** Fires every still-active registered callback once, synchronously. */
  tick(): void {
    for (const entry of this.#entries) {
      if (!entry.cancelled) entry.fn();
    }
  }
}

export function fixedClock(iso: string): { now: () => Date } {
  return { now: () => new Date(iso) };
}
