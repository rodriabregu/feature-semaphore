/**
 * MurmurHash3 (x86, 32-bit) — vendored TypeScript port.
 *
 * Upstream project:  SMHasher / MurmurHash3
 * Upstream author:   Austin Appleby
 * Upstream source:   https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp
 * Upstream commit:   92cf3702fcfaadc84eb7bef59825a23e0cd84f56 (2016-01-09)
 * Licence:           Public domain, per the verbatim header of the upstream source file:
 *
 *   "MurmurHash3 was written by Austin Appleby, and is placed in the public
 *    domain. The author hereby disclaims copyright to this source code."
 *
 * There is no formal SPDX identifier for an ad hoc public-domain disclaimer of
 * this shape; see THIRD_PARTY_NOTICES.md for the full provenance record.
 *
 * This file is an original TypeScript port of the x86 32-bit variant (`MurmurHash3_x86_32`),
 * written directly from the public-domain C++ algorithm description above — the mix
 * constants, rotation amounts, tail handling, and finalization mixing reproduce that
 * algorithm exactly, verified against the canonical SMHasher verification value
 * `0xB0F57EE3` (see `__tests__/murmur3.test.ts`).
 */

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

function rotl32(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

function fmix32(hIn: number): number {
  let h = hIn;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Byte-level entry point. Both the SMHasher self-verification procedure and
 * `bucket()` (via `murmur3_32`) are built on this primitive.
 */
export function murmur3_32_bytes(bytes: Uint8Array, seed = 0): number {
  const len = bytes.length;
  const nblocks = Math.floor(len / 4);
  let h1 = seed | 0;

  for (let i = 0; i < nblocks; i++) {
    const offset = i * 4;
    // Every index below is provably in bounds (offset + 3 < len whenever i < nblocks),
    // so a Uint8Array read here can never be `undefined` — no `?? 0` fallback needed.
    let k1 =
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);

    k1 = Math.imul(k1, C1);
    k1 = rotl32(k1, 15);
    k1 = Math.imul(k1, C2);

    h1 ^= k1;
    h1 = rotl32(h1, 13);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  const tailOffset = nblocks * 4;
  const remainder = len & 3;
  let k1 = 0;
  // Every index read below is provably in bounds for its guarding condition
  // (e.g. tailOffset + 2 < len whenever remainder === 3), so no `?? 0` fallback needed.
  if (remainder === 3) k1 ^= bytes[tailOffset + 2] << 16;
  if (remainder >= 2) k1 ^= bytes[tailOffset + 1] << 8;
  if (remainder >= 1) {
    k1 ^= bytes[tailOffset];
    k1 = Math.imul(k1, C1);
    k1 = rotl32(k1, 15);
    k1 = Math.imul(k1, C2);
    h1 ^= k1;
  }

  h1 ^= len;
  return fmix32(h1) >>> 0;
}

/** String entry point. Always UTF-8 (via `TextEncoder`), never UTF-16. */
export function murmur3_32(input: string, seed = 0): number {
  return murmur3_32_bytes(new TextEncoder().encode(input), seed);
}
