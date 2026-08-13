import type { Clock } from './ports/clock.js';

/** Mirrors `packages/server/src/infrastructure/clock/system-clock.ts`. */
export function createSystemClock(): Clock {
  return { now: () => new Date() };
}
