import { describe, expect, it } from 'vitest';

describe('workspace smoke test', () => {
  it('runs under the configured test pipeline before any domain code exists', () => {
    expect(true).toBe(true);
  });
});
