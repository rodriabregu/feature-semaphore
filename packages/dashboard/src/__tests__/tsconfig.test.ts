/// <reference types="node" />
// Same scoped opt-in as lint-contract.test.ts: this file reads tsconfig.json
// from disk, so it needs `node` ambient types without widening the
// project-wide `types: ['vite/client']` (row 46).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface TsconfigShape {
  readonly extends: string;
  readonly compilerOptions: Record<string, unknown>;
}

describe('dashboard tsconfig diverges from the shared base for Vite/React (D5)', () => {
  it('sets bundler resolution, the react-jsx runtime, vite/client types, keeps composite, and never sets lib', () => {
    const raw = readFileSync(resolve(packageRoot, 'tsconfig.json'), 'utf8');
    const tsconfig: TsconfigShape = JSON.parse(raw) as TsconfigShape;

    expect(tsconfig.extends).toBe('../../tsconfig.base.json');
    expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler');
    expect(tsconfig.compilerOptions.jsx).toBe('react-jsx');
    expect(tsconfig.compilerOptions.types).toEqual(['vite/client']);
    expect(tsconfig.compilerOptions.composite).toBe(true);
    expect(tsconfig.compilerOptions.lib).toBeUndefined();
  });
});
