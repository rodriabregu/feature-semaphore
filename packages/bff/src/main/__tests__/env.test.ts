import { describe, expect, it } from 'vitest';
import { PublicDeploymentRequiresReadOnlyError, readCompositionConfig } from '../env.js';

const BASE_ENV = {
  UPSTREAM_URL: 'http://localhost:3000',
  ADMIN_API_KEY: `fs_admin_${'a'.repeat(43)}`,
  DASHBOARD_PASSWORD: 'correct-horse-battery-staple',
  DASHBOARD_DIST_DIR: '/tmp/does-not-need-to-exist-for-env-parsing',
};

describe('COOKIE_SECURE — row 22', () => {
  it("is insecure only for the exact string 'false'", () => {
    const config = readCompositionConfig({ ...BASE_ENV, COOKIE_SECURE: 'false' });
    expect(config.cookieSecure).toBe(false);
  });

  const secureCases: readonly [label: string, value: string | undefined][] = [
    ['FALSE', 'FALSE'],
    ['0', '0'],
    ['empty string', ''],
    ['unset', undefined],
  ];

  it.each(secureCases)(
    'is secure for %s (anything but the exact string "false")',
    (_label, value) => {
      const env = value === undefined ? { ...BASE_ENV } : { ...BASE_ENV, COOKIE_SECURE: value };
      expect(readCompositionConfig(env).cookieSecure).toBe(true);
    },
  );
});

describe('READ_ONLY_MODE — row 29', () => {
  it("enables read-only only for the exact string 'true'", () => {
    const config = readCompositionConfig({ ...BASE_ENV, READ_ONLY_MODE: 'true' });
    expect(config.readOnly).toBe(true);
  });

  const disabledCases: readonly [label: string, value: string | undefined][] = [
    ['false', 'false'],
    ['FALSE', 'FALSE'],
    ['0', '0'],
    ['empty string', ''],
    ['unset', undefined],
  ];

  it.each(disabledCases)(
    'leaves mutations allowed for %s (anything but the exact string "true")',
    (_label, value) => {
      const env = value === undefined ? { ...BASE_ENV } : { ...BASE_ENV, READ_ONLY_MODE: value };
      expect(readCompositionConfig(env).readOnly).toBe(false);
    },
  );
});

describe('DASHBOARD_DIST_DIR — required, no default (design D9)', () => {
  it('is returned unchanged when set', () => {
    const config = readCompositionConfig(BASE_ENV);
    expect(config.dashboardDistDir).toBe(BASE_ENV.DASHBOARD_DIST_DIR);
  });

  it('throws when absent — no default path is guessed', () => {
    const env = {
      UPSTREAM_URL: BASE_ENV.UPSTREAM_URL,
      ADMIN_API_KEY: BASE_ENV.ADMIN_API_KEY,
      DASHBOARD_PASSWORD: BASE_ENV.DASHBOARD_PASSWORD,
    };
    expect(() => readCompositionConfig(env)).toThrow(/DASHBOARD_DIST_DIR/);
  });
});

describe('Public deployment boot assertion (design D5, #1975)', () => {
  it('refuses to boot: FLY_APP_NAME set, READ_ONLY_MODE unset, no escape hatch', () => {
    expect(() => readCompositionConfig({ ...BASE_ENV, FLY_APP_NAME: 'feature-semaphore-demo' })).toThrow(
      PublicDeploymentRequiresReadOnlyError,
    );
  });

  it('refuses to boot: PUBLIC_DEMO=true, READ_ONLY_MODE unset, no escape hatch', () => {
    expect(() => readCompositionConfig({ ...BASE_ENV, PUBLIC_DEMO: 'true' })).toThrow(
      PublicDeploymentRequiresReadOnlyError,
    );
  });

  it('boots with the escape hatch: FLY_APP_NAME set, ALLOW_WRITES_ON_PUBLIC=true, no READ_ONLY_MODE', () => {
    const config = readCompositionConfig({
      ...BASE_ENV,
      FLY_APP_NAME: 'feature-semaphore-demo',
      ALLOW_WRITES_ON_PUBLIC: 'true',
    });
    expect(config.readOnly).toBe(false);
  });

  it('boots writable: FLY_APP_NAME set, READ_ONLY_MODE=true (the intended public config)', () => {
    const config = readCompositionConfig({
      ...BASE_ENV,
      FLY_APP_NAME: 'feature-semaphore-demo',
      READ_ONLY_MODE: 'true',
    });
    expect(config.readOnly).toBe(true);
  });

  it('boots writable by default: no public signal, READ_ONLY_MODE unset (self-hosted, unaffected)', () => {
    const config = readCompositionConfig(BASE_ENV);
    expect(config.readOnly).toBe(false);
  });
});
