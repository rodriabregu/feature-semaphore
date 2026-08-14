export interface Histogram {
  observe(seconds: number): void;
  snapshot(): {
    readonly buckets: readonly { readonly le: number; readonly count: number }[];
    readonly sum: number;
    readonly count: number;
  };
}

/**
 * Fixed-bucket cumulative accumulator matching the Prometheus histogram
 * contract: each bucket's count is the number of observations <= its `le`
 * threshold, so a single observation increments EVERY bucket whose bound it
 * falls under, not just the narrowest one — that is what makes the buckets
 * cumulative by construction rather than requiring a second pass at read
 * time. The `+Inf` bucket is never stored: it always equals the total
 * observation count, which callers derive from `snapshot().count`.
 */
export function createHistogram(buckets: readonly number[]): Histogram {
  const bounds = [...buckets].sort((a, b) => a - b);
  const counts = new Array<number>(bounds.length).fill(0);
  let sum = 0;
  let count = 0;

  return {
    observe(seconds: number): void {
      sum += seconds;
      count += 1;
      for (let i = 0; i < bounds.length; i += 1) {
        if (seconds <= bounds[i]) counts[i] += 1;
      }
    },
    snapshot() {
      return {
        buckets: bounds.map((le, i) => ({ le, count: counts[i] })),
        sum,
        count,
      };
    },
  };
}
