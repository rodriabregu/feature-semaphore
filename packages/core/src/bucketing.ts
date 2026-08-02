import { murmur3_32 } from './vendor/murmur3.js';

export const TOTAL_BUCKETS = 10_000;

/**
 * C3: rollout percentage → exclusive bucket threshold.
 * `rollout * 100` is not an integer for 1146 of the 10 001 two-decimal values
 * (573 up, 573 down); 0.07 * 100 === 7.000000000000001 would serve 8 buckets.
 * Non-finite input yields NaN, and `bucket < NaN` is false → nobody is in.
 */
export function rolloutThreshold(rollout: number): number {
  return Math.round(rollout * 100);
}

/** Hashes exactly `${flagKey}:${salt}:${unitId}` — colon-joined, no trailing separator. */
export function bucket(flagKey: string, salt: string, unitId: string): number {
  return murmur3_32(`${flagKey}:${salt}:${unitId}`) % TOTAL_BUCKETS;
}
