import { defineConfig } from 'vitest/config';

// No coverage block (C1): a per-project `coverage` block under a `projects`
// topology is silently ignored. The gate lives only in the root config.
//
// LOG_LEVEL=silent: `createServerLogger` reads `LOG_LEVEL` from the
// environment (S1 correction, #1988 review) — every test driving the real
// `buildApp` without a `stream` override would otherwise spray real pino
// JSON into stdout, burying a failing test's actual output. Per-project
// `env` IS respected here (unlike per-project `coverage` above); this must
// stay in this file, never the root `vitest.config.ts`.
export default defineConfig({
  test: { name: 'server', include: ['src/**/*.test.ts'], env: { LOG_LEVEL: 'silent' } },
});
