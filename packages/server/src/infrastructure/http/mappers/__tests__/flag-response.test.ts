import { describe, expect, it } from 'vitest';
import type {
  FlagConfig,
  FlagWithAllEnvironments,
} from '../../../../application/ports/flag-repository.js';
import { configToWire, flagToWire } from '../flag-response.js';

function buildConfig(overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    id: 'config-1',
    flagId: 'flag-1',
    environment: 'development',
    enabled: false,
    offValue: false,
    onValue: true,
    rolloutPercentage: 0,
    salt: 'salt-1',
    version: 1,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('configToWire', () => {
  it('emits exactly the 7-key set, in any order', () => {
    const wire = configToWire(buildConfig());

    expect(Object.keys(wire).sort()).toEqual(
      [
        'enabled',
        'off_value',
        'on_value',
        'rollout_percentage',
        'salt',
        'updated_at',
        'version',
      ].sort(),
    );
  });

  it('renders updated_at as an ISO-8601 string, not a Date', () => {
    const wire = configToWire(buildConfig({ updatedAt: new Date('2026-03-15T12:30:00.000Z') }));

    expect(wire.updated_at).toBe('2026-03-15T12:30:00.000Z');
    expect(typeof wire.updated_at).toBe('string');
  });
});

describe('flagToWire — per-environment updated_at, no flag-level field', () => {
  it('carries an independent updated_at per environment block after mutating only one', () => {
    const flag: FlagWithAllEnvironments = {
      flag: { key: 'flag-1', name: 'Flag 1', description: '', archivedAt: null },
      environments: {
        development: {
          config: buildConfig({
            environment: 'development',
            updatedAt: new Date('2026-06-01T00:00:00.000Z'),
          }),
          rules: [],
          overrides: [],
        },
        production: {
          config: buildConfig({
            environment: 'production',
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
          rules: [],
          overrides: [],
        },
      },
    };

    const wire = flagToWire(flag) as {
      environments: {
        development: { updated_at: string };
        production: { updated_at: string };
      };
    };

    expect(wire.environments.development.updated_at).toBe('2026-06-01T00:00:00.000Z');
    expect(wire.environments.production.updated_at).toBe('2026-01-01T00:00:00.000Z');
    expect(wire.environments.development.updated_at).not.toBe(
      wire.environments.production.updated_at,
    );
  });

  it('adds no flag-level updated_at field', () => {
    const flag: FlagWithAllEnvironments = {
      flag: { key: 'flag-2', name: 'Flag 2', description: '', archivedAt: null },
      environments: {
        development: { config: buildConfig(), rules: [], overrides: [] },
        production: {
          config: buildConfig({ environment: 'production' }),
          rules: [],
          overrides: [],
        },
      },
    };

    const wire = flagToWire(flag);

    expect(Object.keys(wire)).not.toContain('updated_at');
    expect(Object.keys(wire).sort()).toEqual(
      ['archived', 'description', 'environments', 'key', 'name'].sort(),
    );
  });
});
