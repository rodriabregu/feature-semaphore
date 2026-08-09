import { describe, expect, it } from 'vitest';
import {
  MalformedPreconditionError,
  MissingPreconditionError,
  parseIfMatch,
  parseIfNoneMatch,
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

describe('parseIfNoneMatch', () => {
  it('parses a bare entity-tag', () => {
    expect(parseIfNoneMatch('"x"')).toEqual(['x']);
  });

  it('strips the weak-validator prefix', () => {
    expect(parseIfNoneMatch('W/"x"')).toEqual(['x']);
  });

  it('returns the wildcard verbatim', () => {
    expect(parseIfNoneMatch('*')).toEqual(['*']);
  });

  it('parses a comma-separated list of entity-tags', () => {
    expect(parseIfNoneMatch('"a", W/"b", "c"')).toEqual(['a', 'b', 'c']);
  });

  it('never throws on garbage input', () => {
    expect(() => parseIfNoneMatch('not-an-etag-at-all')).not.toThrow();
    expect(parseIfNoneMatch('not-an-etag-at-all')).toEqual(['not-an-etag-at-all']);
  });

  it('returns an empty array when the header is absent', () => {
    expect(parseIfNoneMatch(undefined)).toEqual([]);
  });
});
