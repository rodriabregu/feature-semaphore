import { describe, expect, it } from 'vitest';
import type {
  FlagAggregate,
  PersistedOverride,
  PersistedRule,
} from '../../ports/flag-repository.js';
import { toFlagDefinition } from '../flag-definition.mapper.js';

function rule(position: number, attribute: string): PersistedRule {
  return { position, attribute, operator: 'in', values: ['x'], serve: true, rollout: 100 };
}

describe('toFlagDefinition', () => {
  it('preserves the input array order it was given and does not sort', () => {
    // Given rules persisted (and returned by the adapter) in positions [2, 0, 1]
    // — out of order on purpose — the mapper must NOT reorder them. Ordering is
    // the adapter's SQL `ORDER BY position ASC` guarantee, never the mapper's.
    const c = rule(2, 'c');
    const a = rule(0, 'a');
    const b = rule(1, 'b');

    const aggregate: FlagAggregate = {
      flag: { key: 'checkout-v2', name: 'Checkout v2', description: '', archivedAt: null },
      config: {
        id: 'config-1',
        flagId: 'flag-1',
        environment: 'development',
        enabled: true,
        offValue: false,
        onValue: true,
        rolloutPercentage: 50,
        salt: 'abc',
        version: 1,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      rules: [c, a, b],
      overrides: [],
    };

    const definition = toFlagDefinition(aggregate);

    expect(definition.rules.map((r) => r.attribute)).toEqual(['c', 'a', 'b']);
  });

  it('assembles every field evaluate() requires, rollout as a plain number', () => {
    const overrides: readonly PersistedOverride[] = [{ unitId: 'user-1', serve: false }];
    const aggregate: FlagAggregate = {
      flag: { key: 'checkout-v2', name: 'Checkout v2', description: '', archivedAt: null },
      config: {
        id: 'config-1',
        flagId: 'flag-1',
        environment: 'production',
        enabled: true,
        offValue: false,
        onValue: true,
        rolloutPercentage: 33.33,
        salt: 'salt-1',
        version: 3,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      rules: [],
      overrides,
    };

    const definition = toFlagDefinition(aggregate);

    expect(definition).toEqual({
      key: 'checkout-v2',
      environment: 'production',
      archived: false,
      enabled: true,
      onValue: true,
      offValue: false,
      rollout: 33.33,
      salt: 'salt-1',
      rules: [],
      overrides: { 'user-1': false },
    });
  });

  it('marks archived flags as archived: true', () => {
    const aggregate: FlagAggregate = {
      flag: {
        key: 'old-flag',
        name: 'Old',
        description: '',
        archivedAt: new Date('2026-01-01T00:00:00Z'),
      },
      config: {
        id: 'config-1',
        flagId: 'flag-1',
        environment: 'development',
        enabled: true,
        offValue: false,
        onValue: true,
        rolloutPercentage: 0,
        salt: 'abc',
        version: 1,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      rules: [],
      overrides: [],
    };

    expect(toFlagDefinition(aggregate).archived).toBe(true);
  });
});
