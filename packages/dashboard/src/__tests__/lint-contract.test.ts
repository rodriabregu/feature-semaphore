/// <reference types="node" />
// D1: the dashboard tsconfig deliberately sets `types: ['vite/client']` only
// (row 46) so a Node-only API can never autocomplete into a component. This
// test file legitimately drives ESLint's Node API, so it opts into `node`
// ambient types locally rather than widening the project-wide `types` array.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const IMPORT_REACT_QUERY =
  "import { useQuery } from '@tanstack/react-query';\nexport const q = useQuery;\n";

async function lint(code: string, filePath: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({ cwd: process.cwd() });
  return eslint.lintText(code, { filePath });
}

describe('lint contract — components/** may not import TanStack Query', () => {
  it('errors on an import of @tanstack/react-query inside src/components/', async () => {
    const [result] = await lint(
      IMPORT_REACT_QUERY,
      'packages/dashboard/src/components/BadImport.js',
    );

    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('does not error on the same import inside src/features/', async () => {
    const [result] = await lint(
      IMPORT_REACT_QUERY,
      'packages/dashboard/src/features/GoodImport.js',
    );

    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).not.toContain('no-restricted-imports');
  });
});
