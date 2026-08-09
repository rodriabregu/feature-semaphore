import type { Cancel, Scheduler } from './ports/scheduler.js';

type SetIntervalFn = (fn: () => void, ms: number) => NodeJS.Timeout;

/**
 * The ONLY module naming `setInterval`. `setIntervalFn` defaults to the real
 * global but is injectable, so `every()` calling `.unref()` on the returned
 * handle is asserted at the call site without spawning a subprocess — see
 * `__tests__/timers-scheduler.test.ts`.
 */
export function createTimersScheduler(setIntervalFn: SetIntervalFn = setInterval): Scheduler {
  return {
    every(ms: number, fn: () => void): Cancel {
      const handle = setIntervalFn(fn, ms);
      handle.unref();
      return () => {
        clearInterval(handle);
      };
    },
  };
}
