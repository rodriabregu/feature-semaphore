import { describe, expect, it } from 'vitest';
import { createHistogram } from '../histogram.js';

describe('createHistogram', () => {
  it('starts with every bucket at zero, sum 0, count 0', () => {
    const histogram = createHistogram([0.1, 0.5, 1]);
    expect(histogram.snapshot()).toEqual({
      buckets: [
        { le: 0.1, count: 0 },
        { le: 0.5, count: 0 },
        { le: 1, count: 0 },
      ],
      sum: 0,
      count: 0,
    });
  });

  it('cumulates: an observation increments every bucket whose le is >= the observed value', () => {
    const histogram = createHistogram([0.1, 0.5, 1]);
    histogram.observe(0.3);

    expect(histogram.snapshot()).toEqual({
      buckets: [
        { le: 0.1, count: 0 },
        { le: 0.5, count: 1 },
        { le: 1, count: 1 },
      ],
      sum: 0.3,
      count: 1,
    });
  });

  it('accumulates sum/count across observations and keeps buckets cumulative, including the implicit +Inf (= total count)', () => {
    const histogram = createHistogram([0.1, 0.5, 1]);
    histogram.observe(0.05);
    histogram.observe(0.3);
    histogram.observe(5); // exceeds every finite bucket — only +Inf (the total count) captures it

    const snapshot = histogram.snapshot();
    expect(snapshot).toEqual({
      buckets: [
        { le: 0.1, count: 1 },
        { le: 0.5, count: 2 },
        { le: 1, count: 2 },
      ],
      sum: 5.35,
      count: 3,
    });
    // The +Inf bucket is not stored explicitly — it is always equal to the
    // total observation count, which every finite bucket approaches but the
    // 5-second observation above proves does not necessarily reach.
    expect(snapshot.count).toBe(3);
  });

  it('sorts unsorted bucket bounds before accumulating', () => {
    const histogram = createHistogram([1, 0.1, 0.5]);
    histogram.observe(0.2);

    expect(histogram.snapshot().buckets.map((b) => b.le)).toEqual([0.1, 0.5, 1]);
  });
});
