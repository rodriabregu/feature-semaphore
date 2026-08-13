import type { Delay } from './ports/delay.js';

type SetTimeoutFn = (fn: () => void, ms: number) => NodeJS.Timeout;

/**
 * The ONLY module naming `setTimeout`. Mirrors
 * `packages/sdk-node/src/timers-scheduler.ts:5-11`. `setTimeoutFn` defaults
 * to the real global but is injectable, so the wait is asserted at the call
 * site without spending wall-clock time.
 */
export function createTimersDelay(setTimeoutFn: SetTimeoutFn = setTimeout): Delay {
  return {
    wait(ms: number): Promise<void> {
      return new Promise<void>((resolve) => {
        setTimeoutFn(resolve, ms);
      });
    },
  };
}
