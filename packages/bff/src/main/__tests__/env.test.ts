import { describe, expect, it } from 'vitest';
import { readCompositionConfig } from '../env.js';

const BASE_ENV = {
  UPSTREAM_URL: 'http://localhost:3000',
  ADMIN_API_KEY: `fs_admin_${'a'.repeat(43)}`,
  DASHBOARD_PASSWORD: 'correct-horse-battery-staple',
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
