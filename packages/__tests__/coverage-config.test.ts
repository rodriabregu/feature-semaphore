import { describe, expect, it } from 'vitest';
import rootConfig from '../../vitest.config.js';

/**
 * Minimal glob → RegExp translator, sufficient for exactly the patterns used
 * in vitest.config.ts's `coverage.include` (`*`, `**`, and brace alternation
 * like `{ts,tsx}`). Not a general-purpose glob engine — it only needs to be
 * correct for the handful of patterns this repo actually writes.
 */
function globToRegExp(glob: string): RegExp {
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i += 2;
      if (glob[i] === '/') {
        pattern += '/?';
        i += 1;
      }
      continue;
    }
    if (char === '*') {
      pattern += '[^/]*';
      i += 1;
      continue;
    }
    if (char === '{') {
      const end = glob.indexOf('}', i);
      const options = glob.slice(i + 1, end).split(',');
      pattern += `(?:${options.join('|')})`;
      i = end + 1;
      continue;
    }
    if ('.+^$()|[]\\'.includes(char)) {
      pattern += `\\${char}`;
      i += 1;
      continue;
    }
    pattern += char;
    i += 1;
  }
  return new RegExp(`^${pattern}$`);
}

function matchesAny(globs: readonly string[], path: string): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

interface CoverageShape {
  readonly include?: readonly string[];
  readonly thresholds?: Readonly<Record<string, unknown>>;
}

describe('root coverage config (vitest.config.ts, row 62)', () => {
  const coverage = rootConfig.test?.coverage as CoverageShape | undefined;
  const include = coverage?.include ?? [];
  const thresholds = coverage?.thresholds ?? {};

  it('matches a .tsx path under packages/dashboard/src — fails against the old .ts-only glob', () => {
    expect(matchesAny(include, 'packages/dashboard/src/features/preview/PreviewPage.tsx')).toBe(
      true,
    );
  });

  it('still matches a plain .ts path (regression guard — the fix must not narrow the glob)', () => {
    expect(matchesAny(include, 'packages/core/src/domain/flag.ts')).toBe(true);
  });

  it('does not match a file outside any package src directory', () => {
    expect(matchesAny(include, 'packages/dashboard/vite.config.ts')).toBe(false);
  });

  it('declares a coverage threshold for packages/bff/src/**', () => {
    expect(thresholds['packages/bff/src/**']).toBeDefined();
  });

  it('declares a coverage threshold for packages/dashboard/src/**', () => {
    expect(thresholds['packages/dashboard/src/**']).toBeDefined();
  });
});
