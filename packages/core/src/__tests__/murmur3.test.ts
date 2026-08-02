import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { murmur3_32, murmur3_32_bytes } from '../vendor/murmur3.js';

interface Murmur3Reference {
  readonly primary: { readonly expected: string };
  readonly secondary: {
    readonly seed: number;
    readonly cases: readonly { readonly input: string; readonly hash: number }[];
  };
}

const referencePath = fileURLToPath(
  new URL('../__fixtures__/murmur3-reference.json', import.meta.url),
);
const reference = JSON.parse(readFileSync(referencePath, 'utf8')) as Murmur3Reference;

describe('murmur3_32_bytes — SMHasher verification value', () => {
  it('reproduces the canonical 256-key/256-seed verification value 0xB0F57EE3', () => {
    // Procedure (see __fixtures__/murmur3-reference.json "primary.procedure"):
    // for key length i in 0..255, hash key=[0,1,...,i-1] with seed (256-i),
    // write little-endian into a 1024-byte accumulator, then hash the accumulator with seed 0.
    const hashes = new Uint8Array(256 * 4);
    const view = new DataView(hashes.buffer);

    for (let i = 0; i < 256; i++) {
      const key = new Uint8Array(i);
      for (let b = 0; b < i; b++) key[b] = b;
      const h = murmur3_32_bytes(key, 256 - i);
      view.setUint32(i * 4, h, true);
    }

    const expected = Number.parseInt(reference.primary.expected, 16);
    expect(murmur3_32_bytes(hashes, 0)).toBe(expected);
    expect(expected).toBe(0xb0f57ee3);
  });
});

describe('murmur3_32 — secondary UTF-8 per-string vectors', () => {
  for (const { input, hash } of reference.secondary.cases) {
    it(`hashes ${JSON.stringify(input)} to ${String(hash)} (UTF-8, not UTF-16)`, () => {
      expect(murmur3_32(input, reference.secondary.seed)).toBe(hash);
    });
  }
});
