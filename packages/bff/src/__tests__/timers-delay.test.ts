import { describe, expect, it, vi } from 'vitest';
import { createTimersDelay } from '../timers-delay.js';

describe('createTimersDelay', () => {
  it('row 18: calls the injected setTimeoutFn once with the requested ms, resolves on callback, never busy-waits', async () => {
    let capturedCallback: (() => void) | undefined;
    const setTimeoutFn = vi.fn((fn: () => void) => {
      capturedCallback = fn;
      return {} as NodeJS.Timeout;
    });
    const delay = createTimersDelay(setTimeoutFn);

    let resolved = false;
    const promise = delay.wait(500).then(() => {
      resolved = true;
    });

    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 500);
    // Not resolved yet — proves the wait does not busy-wait or resolve early.
    expect(resolved).toBe(false);

    capturedCallback?.();
    await promise;
    expect(resolved).toBe(true);
  });
});
