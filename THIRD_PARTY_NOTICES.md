# Third-Party Notices

## MurmurHash3 (x86, 32-bit)

- **Vendored at**: `packages/core/src/vendor/murmur3.ts`
- **Upstream project**: SMHasher / MurmurHash3
- **Upstream author**: Austin Appleby
- **Upstream source**: https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp
- **Licence**: Public domain. The upstream source file states, verbatim, in its header
  comment:

  > MurmurHash3 was written by Austin Appleby, and is placed in the public domain. The
  > author hereby disclaims copyright to this source code.

  There is no formal SPDX identifier for an ad hoc public-domain disclaimer of this
  shape (it predates SPDX and is not a registered licence text); this notice records
  the verbatim disclaimer as the licence evidence instead of asserting an approximate
  SPDX tag.

- **Port**: `packages/core/src/vendor/murmur3.ts` is an original TypeScript port of the
  x86 32-bit variant, written directly from the public-domain C++ algorithm description
  above (rotate/mix constants, tail handling, and finalization mixing), not copied
  character-for-character from any JavaScript port.
- **Verification**: the port reproduces the canonical SMHasher verification value
  `0xB0F57EE3` for the 256-key/256-seed self-test procedure (see
  `packages/core/src/__tests__/murmur3.test.ts`).

## murmurhash3js-revisited

- **Used at**: `scripts/crosscheck-vectors.mjs` (root devDependency only — never a
  runtime dependency of `packages/core`)
- **Version**: 3.0.0
- **Licence**: MIT
- **Source**: https://github.com/cimi/murmurhash3js-revisited
- **Purpose**: independent second implementation used to cross-check the generated
  golden bucketing vectors in `packages/core/src/__fixtures__/vectors.json`.
