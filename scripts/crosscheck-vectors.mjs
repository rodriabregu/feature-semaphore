#!/usr/bin/env node
/**
 * Independent authority for packages/core/src/__fixtures__/vectors.json.
 *
 * C7: this script deliberately lives at the repo root and NEVER imports
 * packages/core (enforced by eslint.config.js's per-file no-restricted-imports
 * override on this exact path) — importing core here would turn the check into a
 * tautology (core validating itself).
 *
 * Pinned tool: murmurhash3js-revisited@3.0.0 (MIT), a root devDependency, fed
 * `Array.from(new TextEncoder().encode(str))`. Do NOT substitute `murmurhash3js`:
 * it takes string input with UTF-16 semantics and agrees with the correct UTF-8
 * path only on ASCII, silently diverging on every non-ASCII vector.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import murmurhash3js from 'murmurhash3js-revisited';

const { x86 } = murmurhash3js;

const VECTORS_PATH = fileURLToPath(
  new URL('../packages/core/src/__fixtures__/vectors.json', import.meta.url),
);

const TOTAL_BUCKETS = 10_000;

function independentHash(input, seed) {
  const bytes = Array.from(new TextEncoder().encode(input));
  return x86.hash32(bytes, seed);
}

function main() {
  const document = JSON.parse(readFileSync(VECTORS_PATH, 'utf8'));
  const { seed, cases } = document;

  let matched = 0;
  for (const testCase of cases) {
    const hashInput = `${testCase.flagKey}:${testCase.salt}:${testCase.unitId}`;
    const expectedHash = independentHash(hashInput, seed);
    const expectedBucket = expectedHash % TOTAL_BUCKETS;

    if (expectedHash !== testCase.hash || expectedBucket !== testCase.bucket) {
      console.error(
        `crosscheck:vectors — MISMATCH on case "${String(testCase.id)}"\n` +
          `  expected: hash=${String(expectedHash)} bucket=${String(expectedBucket)}\n` +
          `  actual:   hash=${String(testCase.hash)} bucket=${String(testCase.bucket)}`,
      );
      process.exitCode = 1;
      return;
    }

    matched++;
  }

  const total = cases.length;
  console.log(`crosscheck:vectors — matched ${String(matched)}/${String(total)}`);

  document.crossCheck.matched = `${String(matched)}/${String(total)}`;
  document.crossCheck.date = new Date().toISOString().slice(0, 10);
  writeFileSync(VECTORS_PATH, `${JSON.stringify(document, null, 2)}\n`);
}

main();
