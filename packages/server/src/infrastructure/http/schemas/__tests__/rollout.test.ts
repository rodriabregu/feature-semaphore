import { describe, expect, it } from 'vitest';
import { rolloutSchema } from '../rollout.js';

describe('rolloutSchema', () => {
  it.each([0, 0.07, 0.03, 0.29, 12.34, 99.99, 100])('accepts %s (at most 2 decimals)', (value) => {
    expect(rolloutSchema.parse(value)).toBe(value);
  });

  it('rejects a 3-decimal value with a validation error, never rounding', () => {
    expect(() => rolloutSchema.parse(33.333)).toThrow();
  });

  it('rejects 0.005 (a value multipleOf(0.01) genuinely rejects)', () => {
    expect(() => rolloutSchema.parse(0.005)).toThrow();
  });

  it('rejects values outside [0, 100]', () => {
    expect(() => rolloutSchema.parse(-0.01)).toThrow();
    expect(() => rolloutSchema.parse(100.01)).toThrow();
  });
});
