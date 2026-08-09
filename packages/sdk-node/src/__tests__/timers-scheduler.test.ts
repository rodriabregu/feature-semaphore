import { describe, expect, it, vi } from 'vitest';
import { createTimersScheduler } from '../timers-scheduler.js';

describe('createTimersScheduler', () => {
  it('row 35: every() calls .unref() on the handle returned by the injected setIntervalFn', () => {
    const unref = vi.fn();
    const fakeHandle = { unref } as unknown as NodeJS.Timeout;
    const setIntervalFn = vi.fn(() => fakeHandle);
    const scheduler = createTimersScheduler(setIntervalFn);

    const cancel = scheduler.every(1000, () => undefined);

    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(unref).toHaveBeenCalledTimes(1);

    // cancel() must not throw even against a fake handle.
    expect(() => {
      cancel();
    }).not.toThrow();
  });
});
