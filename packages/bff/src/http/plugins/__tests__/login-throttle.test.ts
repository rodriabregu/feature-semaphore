import { describe, expect, it } from 'vitest';
import type { Delay } from '../../../ports/delay.js';
import { createLoginThrottle } from '../login-throttle.js';

function fakeDelay(): { delay: Delay; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    delay: {
      wait(ms: number): Promise<void> {
        calls.push(ms);
        return Promise.resolve();
      },
    },
  };
}

describe('createLoginThrottle', () => {
  it('row 13: three consecutive failures request exactly 250, 500 and 1000 ms', async () => {
    const { delay, calls } = fakeDelay();
    const throttle = createLoginThrottle(delay);

    await throttle.attempt(() => false);
    await throttle.attempt(() => false);
    await throttle.attempt(() => false);

    expect(calls).toEqual([250, 500, 1000]);
  });

  it('row 14: the 4th and the 10th consecutive failure both request exactly 2000 ms', async () => {
    const { delay, calls } = fakeDelay();
    const throttle = createLoginThrottle(delay);

    for (let i = 0; i < 9; i += 1) {
      await throttle.attempt(() => false);
    }
    const fourth = calls[3];

    await throttle.attempt(() => false); // 10th
    const tenth = calls[9];

    expect(fourth).toBe(2000);
    expect(tenth).toBe(2000);
  });

  it('row 15: after 20 consecutive failures, the correct password still succeeds, delayed by the cap, never refused', async () => {
    const { delay, calls } = fakeDelay();
    const throttle = createLoginThrottle(delay);

    for (let i = 0; i < 20; i += 1) {
      await throttle.attempt(() => false);
    }
    calls.length = 0;

    const success = await throttle.attempt(() => true);

    expect(success).toBe(true);
    expect(calls).toEqual([2000]);
  });

  it('row 16: after 3 failures then a success, the next failure requests 250 ms, not 1000', async () => {
    const { delay, calls } = fakeDelay();
    const throttle = createLoginThrottle(delay);

    await throttle.attempt(() => false);
    await throttle.attempt(() => false);
    await throttle.attempt(() => false);
    await throttle.attempt(() => true);
    calls.length = 0;

    await throttle.attempt(() => false);

    expect(calls).toEqual([250]);
  });

  it('row 17: requests a naive per-client scheme would treat as different clients share one global counter', async () => {
    const { delay, calls } = fakeDelay();
    const throttle = createLoginThrottle(delay);

    // No client identity is ever passed to attempt() — there is nothing to
    // partition by. Three failures escalate the shared counter regardless of
    // which "client" a naive scheme would imagine made each call.
    await throttle.attempt(() => false);
    await throttle.attempt(() => false);
    await throttle.attempt(() => false);
    calls.length = 0;

    await throttle.attempt(() => false);

    expect(calls).toEqual([2000]);
  });
});
