import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readCompositionConfig } from '../main/env.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface TsconfigShape {
  readonly extends: string;
  readonly compilerOptions: Record<string, unknown>;
}

describe('bff tsconfig does not diverge from the shared base', () => {
  it('extends tsconfig.base.json, overriding only rootDir/outDir', () => {
    const raw = readFileSync(resolve(packageRoot, 'tsconfig.json'), 'utf8');
    const tsconfig: TsconfigShape = JSON.parse(raw) as TsconfigShape;

    expect(tsconfig.extends).toBe('../../tsconfig.base.json');
    expect(Object.keys(tsconfig.compilerOptions).sort()).toEqual(['outDir', 'rootDir']);
    expect(tsconfig.compilerOptions.rootDir).toBe('src');
    expect(tsconfig.compilerOptions.outDir).toBe('.tsbuild');
  });
});

describe('readCompositionConfig — fail-fast, no localhost default', () => {
  const VALID_ENV = {
    UPSTREAM_URL: 'http://localhost:3000',
    ADMIN_API_KEY: `fs_admin_${'a'.repeat(43)}`,
    DASHBOARD_PASSWORD: 'correct-horse-battery-staple',
  };

  it('returns the config unchanged when all three variables are set', () => {
    const config = readCompositionConfig(VALID_ENV);

    expect(config).toEqual({
      upstreamUrl: 'http://localhost:3000',
      adminApiKey: VALID_ENV.ADMIN_API_KEY,
      dashboardPassword: 'correct-horse-battery-staple',
      cookieSecure: true,
      readOnly: false,
    });
  });

  it('throws when UPSTREAM_URL is absent — no localhost default', () => {
    const env = {
      ADMIN_API_KEY: VALID_ENV.ADMIN_API_KEY,
      DASHBOARD_PASSWORD: VALID_ENV.DASHBOARD_PASSWORD,
    };
    expect(() => readCompositionConfig(env)).toThrow(/UPSTREAM_URL/);
  });

  it('throws when ADMIN_API_KEY is absent', () => {
    const env = {
      UPSTREAM_URL: VALID_ENV.UPSTREAM_URL,
      DASHBOARD_PASSWORD: VALID_ENV.DASHBOARD_PASSWORD,
    };
    expect(() => readCompositionConfig(env)).toThrow(/ADMIN_API_KEY/);
  });

  it('throws when DASHBOARD_PASSWORD is absent', () => {
    const env = { UPSTREAM_URL: VALID_ENV.UPSTREAM_URL, ADMIN_API_KEY: VALID_ENV.ADMIN_API_KEY };
    expect(() => readCompositionConfig(env)).toThrow(/DASHBOARD_PASSWORD/);
  });
});
