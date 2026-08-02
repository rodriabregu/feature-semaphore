import { describe, expect, it } from 'vitest';
import { bucket, rolloutThreshold, TOTAL_BUCKETS } from '../bucketing.js';

describe('rolloutThreshold', () => {
  it('is exact for every one of the 10,001 representable two-decimal values in [0.00, 100.00]', () => {
    // C3: `rollout * 100` is not reliably an integer in IEEE-754 (0.07 * 100 ===
    // 7.000000000000001). This exhaustive loop catches all 1146 divergent values
    // in one assertion pass — the expectation comes from integer arithmetic (i),
    // not from the function under test.
    for (let i = 0; i <= 10_000; i++) {
      expect(rolloutThreshold(i / 100)).toBe(i);
    }
  });

  it('pins 0.07 to exactly 7 buckets, not 8', () => {
    expect(rolloutThreshold(0.07)).toBe(7);

    let admitted = 0;
    for (let b = 0; b < TOTAL_BUCKETS; b++) {
      if (b < rolloutThreshold(0.07)) admitted++;
    }
    expect(admitted).toBe(7);
  });

  it('converts a two-decimal rollout of 12.34 to threshold 1234', () => {
    expect(rolloutThreshold(12.34)).toBe(1234);
  });

  it('yields NaN for non-finite rollout, so nobody is admitted', () => {
    const threshold = rolloutThreshold(Number.NaN);
    expect(Number.isNaN(threshold)).toBe(true);
    expect(0 < threshold).toBe(false);
  });
});

describe('bucket', () => {
  it('is deterministic across 10,000 repeated calls with identical inputs', () => {
    const first = bucket('flag-a', 'salt-1', 'user-1');
    for (let i = 0; i < 10_000; i++) {
      expect(bucket('flag-a', 'salt-1', 'user-1')).toBe(first);
    }
    expect(first).toBe(4303);
  });

  it('decorrelates rollouts across flags: flagKey is part of the hash input', () => {
    // Oracle values precomputed via the pinned murmurhash3js-revisited@3.0.0
    // library over `${flagKey}:${salt}:${unitId}` before this implementation existed.
    expect(bucket('flag-a', 'salt-1', 'user-1')).toBe(4303);
    expect(bucket('flag-b', 'salt-1', 'user-1')).toBe(5434);
  });

  it('re-randomizes assignment on salt rotation without changing flagKey', () => {
    expect(bucket('flag-a', 'salt-1', 'user-1')).toBe(4303);
    expect(bucket('flag-a', 'salt-2', 'user-1')).toBe(7396);
  });
});
