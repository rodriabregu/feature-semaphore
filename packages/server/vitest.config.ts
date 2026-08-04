import { defineConfig } from 'vitest/config';

// No coverage block (C1): a per-project `coverage` block under a `projects`
// topology is silently ignored. The gate lives only in the root config.
export default defineConfig({ test: { name: 'server', include: ['src/**/*.test.ts'] } });
