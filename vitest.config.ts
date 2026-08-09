import { defineConfig } from 'vitest/config';

// C1: the coverage gate lives at the ROOT, glob-keyed, not inside a project config.
// Vitest computes coverage once for the whole process and rejects a `coverage` block
// declared inside a project config under a `projects` topology — a per-project
// threshold is silently ignored with no fallback, which is a green run enforcing
// nothing. This root config is therefore the ONLY place a coverage threshold may live.
export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/__tests__/**', '**/__fixtures__/**'],
      thresholds: {
        'packages/core/src/**': { lines: 95, functions: 95, branches: 95, statements: 95 },
        'packages/sdk-node/src/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});
