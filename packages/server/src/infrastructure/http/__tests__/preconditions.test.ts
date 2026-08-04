import { describe, expect, it } from 'vitest';
import {
  MalformedPreconditionError,
  MissingPreconditionError,
  parseIfMatch,
} from '../preconditions.js';

describe('parseIfMatch', () => {
  it.each(['7', 7, 'W/"7"', '"7"'])('parses %s to 7', (value) => {
    expect(parseIfMatch(value)).toBe(7);
  });

  it('throws MissingPreconditionError when the header is absent', () => {
    expect(() => parseIfMatch(undefined)).toThrow(MissingPreconditionError);
  });

  it('throws MalformedPreconditionError for a non-numeric value', () => {
    expect(() => parseIfMatch('abc')).toThrow(MalformedPreconditionError);
  });
});
