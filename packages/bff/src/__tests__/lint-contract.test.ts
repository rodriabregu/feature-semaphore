/// <reference types="node" />
// This test file drives ESLint's Node API directly, mirroring
// packages/dashboard/src/__tests__/lint-contract.test.ts:1-6.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const CALLS_APP_GET = "export function bad(app) {\n  app.get('/x', () => {});\n}\n";

async function lint(code: string, filePath: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({ cwd: process.cwd() });
  return eslint.lintText(code, { filePath });
}

describe('lint contract — route registration is confined to the registrar (row 31)', () => {
  it('errors on app.get(...) inside packages/bff/src/http/ outside the registrar', async () => {
    const [result] = await lint(CALLS_APP_GET, 'packages/bff/src/http/plugins/BadRoute.js');

    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain('no-restricted-syntax');
  });

  it('does not error on the same call inside proxy/register-proxy.ts', async () => {
    const [result] = await lint(CALLS_APP_GET, 'packages/bff/src/http/proxy/register-proxy.js');

    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).not.toContain('no-restricted-syntax');
  });

  it('does not error on the same call inside routes/session.routes.ts', async () => {
    const [result] = await lint(CALLS_APP_GET, 'packages/bff/src/http/routes/session.routes.js');

    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).not.toContain('no-restricted-syntax');
  });
});
