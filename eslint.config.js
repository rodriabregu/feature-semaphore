// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/.tsbuild/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts', 'packages/*/vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // C5: `no-restricted-globals` matches bare identifiers only, never member
      // expressions — it can never match `Math.random`. The repo-wide ban on
      // nondeterminism therefore has to be a property ban, not a global ban.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Nondeterminism is banned: fixtures and property tests must be reproducible.',
        },
      ],
      // EvaluationReason (types.ts) is built from template literal types like
      // `RULE_MATCH:${number}` by design — numeric interpolation is load-bearing here.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // packages/core purity: zero runtime dependencies, no Node-only globals, no IO.
    // Scoped to the shipped source only — test files under __tests__ legitimately
    // read fixture JSON from disk via `node:fs` and are not part of the published package.
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/__tests__/**', 'packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'packages/core must not reference Node-only globals.' },
        { name: 'Buffer', message: 'packages/core must not reference Node-only globals.' },
        { name: '__dirname', message: 'packages/core must not reference Node-only globals.' },
        { name: '__filename', message: 'packages/core must not reference Node-only globals.' },
        { name: 'require', message: 'packages/core must not reference Node-only globals.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'fs',
              message: 'packages/core must have zero runtime dependencies and perform no IO.',
            },
            {
              name: 'path',
              message: 'packages/core must have zero runtime dependencies and perform no IO.',
            },
            {
              name: 'crypto',
              message: 'packages/core must have zero runtime dependencies and perform no IO.',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'packages/core must have zero runtime dependencies and perform no IO.',
            },
          ],
        },
      ],
    },
  },
  {
    // C7: the cross-check script must not import core — otherwise the check becomes
    // a tautology (core validating itself). Ban is scoped to this exact file only;
    // the generator in the same directory legitimately imports the built core package.
    files: ['scripts/crosscheck-vectors.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/packages/core/**'],
              message: 'crosscheck-vectors.mjs must stay independent of packages/core.',
            },
          ],
        },
      ],
    },
  },
  {
    // Plain JS/config files: reset to the untyped parser. typescript-eslint's
    // `base` config sets the type-aware parser for ALL files unconditionally
    // (files: undefined), so JS files must explicitly opt back out.
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      sourceType: 'module',
    },
    extends: [tseslint.configs.disableTypeChecked],
  },
);
