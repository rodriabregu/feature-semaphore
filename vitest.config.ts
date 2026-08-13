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
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', '**/__fixtures__/**'],
      thresholds: {
        'packages/core/src/**': { lines: 95, functions: 95, branches: 95, statements: 95 },
        'packages/sdk-node/src/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        // Measured at fix time (D8): lines 92.48%, functions 91.89%, branches
        // 85.71%, statements 92.91%. Set a few points below each measured
        // value — not copied from sdk-node's row — because `main/index.ts`
        // and `main/server.ts` are thin bootstrap glue (0% covered by
        // design, same class of file `packages/server/src/main` already
        // leaves untested with no threshold at all) that drags the small
        // package's aggregate down disproportionately; branches gets the
        // largest buffer (5+ points) since it is the noisiest metric across
        // a package this size, where a single new conditional can swing the
        // percentage several points in one PR.
        'packages/bff/src/**': { lines: 90, functions: 90, branches: 80, statements: 90 },
        // Matches the design's own recorded intent (`#1897` §16: "Dashboard
        // coverage 80/80/70/80 ... deliberately below sdk-node's
        // 90/90/85/90"). Measured at fix time: lines 87.06%, functions
        // 83.44%, branches 79.90%, statements 86.95% — every metric clears
        // this floor with real margin (3-10 points), confirming the
        // design's number was realistic rather than aspirational. Branches
        // keeps the lowest floor because React conditional rendering
        // (loading/error/empty states across 4 screens) creates far more
        // branch paths per line than the BFF's plumbing does.
        'packages/dashboard/src/**': { lines: 80, functions: 80, branches: 70, statements: 80 },
      },
    },
  },
});
