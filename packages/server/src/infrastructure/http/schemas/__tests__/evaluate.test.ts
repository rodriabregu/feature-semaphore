import { describe, expect, it } from 'vitest';
import { previewBody } from '../evaluate.js';

const VALID_BODY = {
  flag_key: 'checkout-v2',
  environment: 'development',
  context: { unit_id: 'user-1', attributes: {}, default_value: false },
};

describe('previewBody — salt rejected at every nesting level', () => {
  it('rejects a top-level salt, path ""', () => {
    const result = previewBody.safeParse({ ...VALID_BODY, salt: 'x' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    expect(result.error?.issues[0]?.path).toEqual([]);
  });

  it('rejects candidate.salt, path "candidate"', () => {
    const result = previewBody.safeParse({ ...VALID_BODY, candidate: { salt: 'x' } });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    expect(result.error?.issues[0]?.path).toEqual(['candidate']);
  });

  it.each(['version', 'archived', 'key', 'environment'])(
    'rejects candidate.%s, path "candidate"',
    (field) => {
      const result = previewBody.safeParse({ ...VALID_BODY, candidate: { [field]: 'x' } });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
      expect(result.error?.issues[0]?.path).toEqual(['candidate']);
    },
  );

  it('rejects candidate.rules[0].salt at path candidate.rules.0, asserting code AND path', () => {
    const result = previewBody.safeParse({
      ...VALID_BODY,
      candidate: {
        rules: [
          {
            operator: 'in',
            attribute: 'plan',
            values: ['pro'],
            serve: true,
            rollout: 100,
            salt: 'x',
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    expect(result.error?.issues[0]?.path).toEqual(['candidate', 'rules', 0]);
  });

  it('rejects candidate.overrides[0].salt at path candidate.overrides.0', () => {
    const result = previewBody.safeParse({
      ...VALID_BODY,
      candidate: { overrides: [{ unit_id: 'u', serve: true, salt: 'x' }] },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    expect(result.error?.issues[0]?.path).toEqual(['candidate', 'overrides', 0]);
  });

  it('accepts a context.attributes key literally named "salt" — routed to attributes, never a definition field', () => {
    const result = previewBody.safeParse({
      ...VALID_BODY,
      context: { unit_id: 'user-1', attributes: { salt: 'sea' }, default_value: false },
    });

    expect(result.success).toBe(true);
    expect(result.data?.context.attributes.salt).toBe('sea');
  });
});
