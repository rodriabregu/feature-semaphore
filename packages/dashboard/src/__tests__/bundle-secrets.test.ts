// @vitest-environment node
//
// A production `vite build` is a real Node-side compiler pass — running it
// under the dashboard project's default `jsdom` environment breaks esbuild's
// `TextEncoder` invariant (jsdom's patched globals are incompatible with it).
// The docblock above overrides the environment for this file only.
import { describe, expect, it, beforeAll } from 'vitest';
import { build } from 'vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DASHBOARD_ROOT = join(import.meta.dirname, '..', '..');
const SRC_ROOT = join(DASHBOARD_ROOT, 'src');

/** `fs_admin_<43 chars>` (packages/server/src/infrastructure/persistence/seed/admin-key.ts) —
 * the ONLY shape `ADMIN_API_KEY` ever takes. The dashboard never receives this
 * value (design §10: it lives server-side, in the BFF's `forward()` only), so
 * its literal prefix must never appear in a built dashboard asset. */
const ADMIN_KEY_PREFIX = 'fs_admin_';

function listJsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(dir, name));
}

/**
 * Walks shipped dashboard source only. `__tests__` directories are excluded —
 * this very file's own assertion string (`'document.cookie'`) would
 * otherwise flag itself as a false positive, and test files are never part
 * of the production bundle in the first place.
 */
function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === '__tests__') {
      continue;
    }
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('dashboard bundle contains no server-side secrets (row 63)', () => {
  let assetsDir: string;

  beforeAll(async () => {
    await build({
      root: DASHBOARD_ROOT,
      configFile: join(DASHBOARD_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
    });
    assetsDir = join(DASHBOARD_ROOT, 'dist', 'assets');
  }, 30_000);

  it('produces at least one built JS asset to inspect', () => {
    expect(listJsFiles(assetsDir).length).toBeGreaterThan(0);
  });

  it('no built asset contains the admin-key literal prefix', () => {
    const files = listJsFiles(assetsDir);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toContain(ADMIN_KEY_PREFIX);
    }
  });

  it('no built asset contains a DASHBOARD_PASSWORD value supplied to this build', () => {
    // The dashboard build never sees DASHBOARD_PASSWORD (a BFF-only secret),
    // so this only guards against a future regression that threads it
    // through as a `VITE_*`-prefixed env var by mistake.
    const password = process.env.DASHBOARD_PASSWORD;
    if (password === undefined || password.length === 0) {
      return;
    }
    const files = listJsFiles(assetsDir);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toContain(password);
    }
  });

  it('no dashboard source file reads document.cookie', () => {
    // The session cookie is HttpOnly (design §10.4/§14 row 19) — the
    // dashboard has no legitimate reason to ever read it directly.
    const files = listSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toContain('document.cookie');
    }
  });
});
