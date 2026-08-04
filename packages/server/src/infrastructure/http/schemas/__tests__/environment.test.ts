import { describe, expect, it } from 'vitest';
import { environmentSchema } from '../environment.js';

describe('environmentSchema', () => {
  it.each(['development', 'production'])('accepts %s', (value) => {
    expect(environmentSchema.parse(value)).toBe(value);
  });

  it('rejects an unrecognised environment value — a 400 shape, never a 403', () => {
    expect(() => environmentSchema.parse('staging')).toThrow();
  });

  it('rejects an empty segment', () => {
    expect(() => environmentSchema.parse('')).toThrow();
  });
});
