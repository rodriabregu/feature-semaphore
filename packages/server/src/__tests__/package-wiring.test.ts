import { describe, expect, it } from 'vitest';
import { evaluate } from '@rodriab/feature-semaphore-core';
import type { Environment } from '@rodriab/feature-semaphore-core';

describe('package wiring', () => {
  it('resolves the core workspace dependency and its Environment type', () => {
    expect(typeof evaluate).toBe('function');

    // Compile-time proof of the D7 re-export: this assignment fails TS2305 if
    // `Environment` is not re-exported from core/src/index.ts.
    const e: Environment = 'development';
    expect(e).toBe('development');
  });
});
