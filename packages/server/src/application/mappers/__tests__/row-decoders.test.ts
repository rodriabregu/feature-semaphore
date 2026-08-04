import { describe, expect, it } from 'vitest';
import { CorruptRowError } from '../../errors/domain-error.js';
import { decodeRule } from '../row-decoders.js';

describe('decodeRule', () => {
  it('decodes a well-formed "in" rule into a typed TargetingRule', () => {
    const rule = decodeRule({
      attribute: 'country',
      operator: 'in',
      values: ['US', 'CA'],
      serve: true,
      rollout: 100,
    });

    expect(rule).toEqual({
      attribute: 'country',
      operator: 'in',
      values: ['US', 'CA'],
      serve: true,
      rollout: 100,
    });
  });

  it('throws CorruptRowError with issue paths, never values, for malformed values', () => {
    expect.assertions(3);
    try {
      decodeRule({ operator: 'gt', values: ['x'], attribute: 'age', serve: true, rollout: 50 });
    } catch (error) {
      expect(error).toBeInstanceOf(CorruptRowError);
      const corruptRowError = error as CorruptRowError;
      expect(corruptRowError.issuePaths.length).toBeGreaterThan(0);
      expect(JSON.stringify(corruptRowError.issuePaths)).not.toContain('"x"');
    }
  });

  it('throws CorruptRowError for an unknown operator', () => {
    expect(() =>
      decodeRule({ operator: 'unknown', values: [], attribute: 'x', serve: true, rollout: 0 }),
    ).toThrow(CorruptRowError);
  });
});
