import { describe, expect, it } from 'vitest';
import { lastModified } from '../last-modified.js';
import type { FlagWire } from '../../../api/types.js';

function makeEnv(updatedAt: string) {
  return {
    enabled: true,
    off_value: false,
    on_value: true,
    rollout_percentage: 0,
    salt: 'salt',
    updated_at: updatedAt,
    version: 1,
    rules: [],
    overrides: {},
  };
}

function makeFlag(developmentUpdatedAt: string, productionUpdatedAt: string): FlagWire {
  return {
    key: 'flag-1',
    name: 'Flag 1',
    description: '',
    archived: false,
    environments: {
      development: makeEnv(developmentUpdatedAt),
      production: makeEnv(productionUpdatedAt),
    },
  };
}

describe('lastModified — env-labelled max(updated_at) (row 51)', () => {
  it('renders the development timestamp, labelled development, when development is later', () => {
    const flag = makeFlag('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    expect(lastModified(flag)).toEqual({
      at: '2026-01-02T00:00:00.000Z',
      environment: 'development',
    });
  });

  it('renders the production timestamp, labelled production, when production is later', () => {
    const flag = makeFlag('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');

    expect(lastModified(flag)).toEqual({
      at: '2026-01-02T00:00:00.000Z',
      environment: 'production',
    });
  });

  it('an exact tie resolves to production', () => {
    const tie = '2026-01-01T12:00:00.000Z';
    const flag = makeFlag(tie, tie);

    expect(lastModified(flag)).toEqual({ at: tie, environment: 'production' });
  });
});
