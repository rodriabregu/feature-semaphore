import { describe, expect, it } from 'vitest';
import { evaluate } from '@rodriab/feature-semaphore-core';
import type { Environment } from '@rodriab/feature-semaphore-core';

describe('package wiring', () => {
  it('row 37: import { evaluate } from @rodriab/feature-semaphore-core resolves', () => {
    expect(typeof evaluate).toBe('function');
  });

  it('row 37: Environment is importable and usable as a type (type half gated by pnpm typecheck)', () => {
    const e: Environment = 'development';
    expect(e).toBe('development');
  });
});
