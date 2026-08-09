import { defineConfig } from 'vitest/config';

// No coverage block here (C1): a per-project `coverage` block under a
// `projects` topology is silently ignored. The coverage gate (added in WU6)
// lives only in the root config.
export default defineConfig({
  test: { name: 'sdk-node', include: ['src/**/*.test.ts'] },
});
