import type { Clock } from '../../application/ports/clock.js';

export function createSystemClock(): Clock {
  return { now: () => new Date() };
}
