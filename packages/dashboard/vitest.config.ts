import { defineConfig } from 'vitest/config';

// No coverage block here (C1): a per-project `coverage` block under a
// `projects` topology is silently ignored. The coverage gate lives only in
// the root config.
export default defineConfig({
  test: {
    name: 'dashboard',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/vitest-setup.ts'],
  },
});
