// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';

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
          allowDefaultProject: [
            'vitest.config.ts',
            'packages/*/vitest.config.ts',
            'packages/*/vite.config.ts',
          ],
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
    // D1: React/hooks/a11y linting, scoped to the dashboard only — no other
    // package renders JSX or touches the DOM.
    files: ['packages/dashboard/src/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat['jsx-runtime'].rules,
      ...reactHooksPlugin.configs.flat['recommended-latest'].rules,
      ...jsxA11yPlugin.configs.recommended.rules,
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      // Pinned rather than 'detect': react/react-dom are not installed until
      // D2 adds the app shell, and 'detect' would fail with nothing to find.
      react: { version: '19.0.0' },
    },
  },
  {
    // D1 / D3: `components/**` are pure, prop-driven, and lint-forbidden from
    // fetching — the only place TanStack Query may be imported is `features/`
    // (the container layer) or `api/`. Mirrors the `packages/core` purity ban
    // (eslint.config.js:58-83) as the same file-scoped-carve-out technique.
    files: ['packages/dashboard/src/components/**/*.{ts,tsx,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              message:
                'components/** must stay presentational — fetch only from features/ or api/.',
            },
          ],
        },
      ],
    },
  },
  {
    // D3: the read-only gate's whole guarantee rests on the registrar being
    // the ONLY module that can register a proxied route — a path absent from
    // `PROXY_ROUTES` is a 404 by construction, not a runtime check, and that
    // is only true if nothing else in packages/bff/src/http/** can call
    // app.route/get/post/put/patch/delete. Same file-scoped-carve-out
    // technique as the packages/core purity ban (eslint.config.js:54-91) and
    // the dashboard's components/** fetch ban above. `proxy/register-proxy.ts`
    // (the registrar) and `routes/session.routes.ts` (login/logout, the only
    // other route-registering module by design) are exempt; test fixtures
    // legitimately register ad-hoc routes on scoped test apps.
    files: ['packages/bff/src/http/**/*.{ts,js}'],
    ignores: [
      'packages/bff/src/http/**/__tests__/**',
      'packages/bff/src/http/proxy/register-proxy.*',
      'packages/bff/src/http/routes/session.routes.*',
      // `forward.ts` (B3b) never receives a `FastifyInstance` — only
      // `ProxyDeps`, `FastifyRequest` and `FastifyReply`, none of which
      // expose route-registration methods — so it is structurally
      // incapable of calling `app.route()`/`.get()`/etc regardless of this
      // exemption. Without this entry, the selector's blunt name-only match
      // (it cannot see receiver types) also catches the unrelated, spec-
      // mandated `upstream.headers.get(name)` read in the fidelity
      // passthrough (design Part 1 §4) — a false positive, not a real gap
      // in the registrar's exclusivity.
      'packages/bff/src/http/proxy/forward.*',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(get|post|put|patch|delete|route)$/]",
          message:
            'Route registration is confined to proxy/register-proxy.ts (proxied routes) and routes/session.routes.ts (login/logout) — no other module in packages/bff/src/http/** may call app.route()/get()/post()/put()/patch()/delete().',
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
