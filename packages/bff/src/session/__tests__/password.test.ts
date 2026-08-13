import { describe, expect, it } from 'vitest';
import { comparePassword } from '../password.js';

describe('comparePassword', () => {
  it('row 11: a submitted password of a different length returns false, never throws', () => {
    expect(() => {
      comparePassword('short', 'a-much-longer-configured-password');
    }).not.toThrow();
    expect(comparePassword('short', 'a-much-longer-configured-password')).toBe(false);
  });

  it('returns true for a matching password', () => {
    expect(comparePassword('correct-horse-battery-staple', 'correct-horse-battery-staple')).toBe(
      true,
    );
  });

  it('returns false for a same-length but different password', () => {
    expect(comparePassword('aaaaaaaa', 'bbbbbbbb')).toBe(false);
  });
});
