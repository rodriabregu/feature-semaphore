#!/usr/bin/env node
/**
 * Deterministic golden-vector generator for packages/core/src/__fixtures__/vectors.json.
 *
 * C10: lives at the repo ROOT, not inside packages/core — that package has zero
 * runtime dependencies and performs no IO, so any Node-executable tooling must sit
 * outside it. This script imports the BUILT `packages/core/dist/**` output (never
 * the un-built `src/`), so vectors are generated from the shipped bytes.
 *
 * No `Math.random()` anywhere: every "found by search" case below is located with a
 * seeded 32-bit LCG, so re-running this script (via `pnpm vectors:generate`)
 * regenerates a byte-identical file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { bucket, rolloutThreshold } from '../packages/core/dist/index.js';
import { murmur3_32 } from '../packages/core/dist/vendor/murmur3.js';

const TOTAL_BUCKETS = 10_000;
const VECTORS_PATH = fileURLToPath(
  new URL('../packages/core/src/__fixtures__/vectors.json', import.meta.url),
);

/** `s = (s * 1664525 + 1013904223) mod 2^32` — the same seeded LCG used by properties.test.ts. */
function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function computeCase(id, flagKey, salt, unitId, note) {
  const hash = murmur3_32(`${flagKey}:${salt}:${unitId}`);
  return { id, flagKey, salt, unitId, hash, bucket: hash % TOTAL_BUCKETS, note };
}

/** Searches deterministically-generated unit ids until `bucket() === targetBucket`. */
function findUnitIdForBucket(flagKey, salt, targetBucket, lcg, maxAttempts = 200_000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const unitId = `search-${lcg().toString(16)}`;
    if (bucket(flagKey, salt, unitId) === targetBucket) return unitId;
  }
  throw new Error(`findUnitIdForBucket: no match for bucket ${String(targetBucket)} within budget`);
}

/** Searches deterministically-generated unit ids until the RAW hash has the high bit set. */
function findUnitIdWithHighBitHash(flagKey, salt, lcg, exclude, maxAttempts = 200_000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const unitId = `search-${lcg().toString(16)}`;
    if (exclude.has(unitId)) continue;
    const hash = murmur3_32(`${flagKey}:${salt}:${unitId}`);
    if (hash >= 0x80000000) {
      exclude.add(unitId);
      return unitId;
    }
  }
  throw new Error('findUnitIdWithHighBitHash: no match within budget');
}

function buildCases() {
  const cases = [];
  const lcg = makeLcg(0x5eed_0001);

  // Bucket boundary: exact bucket 0 and exact bucket 9999, found by search.
  const zeroUnitId = findUnitIdForBucket('checkout-v2', 's1', 0, lcg);
  cases.push(
    computeCase('boundary-bucket-min', 'checkout-v2', 's1', zeroUnitId, 'lowest observed bucket'),
  );
  const maxUnitId = findUnitIdForBucket('checkout-v2', 's1', TOTAL_BUCKETS - 1, lcg);
  cases.push(
    computeCase(
      'boundary-bucket-max',
      'checkout-v2',
      's1',
      maxUnitId,
      'highest observed bucket (9999)',
    ),
  );

  // Rollout boundary: 0%, 100%, and the exact threshold(r)-1 / threshold(r) pair for r=42.00.
  cases.push(computeCase('rollout-boundary-0pct', 'rollout-flag', 'rs', 'unit-a', 'rollout 0%'));
  cases.push(
    computeCase('rollout-boundary-100pct', 'rollout-flag', 'rs', 'unit-a', 'rollout 100%'),
  );
  const threshold42 = rolloutThreshold(42.0);
  const belowThresholdUnitId = findUnitIdForBucket('rollout-flag', 'rs', threshold42 - 1, lcg);
  cases.push(
    computeCase(
      'rollout-threshold-minus-one',
      'rollout-flag',
      'rs',
      belowThresholdUnitId,
      `bucket === rolloutThreshold(42.00) - 1 === ${String(threshold42 - 1)}`,
    ),
  );
  const atThresholdUnitId = findUnitIdForBucket('rollout-flag', 'rs', threshold42, lcg);
  cases.push(
    computeCase(
      'rollout-threshold-exact',
      'rollout-flag',
      'rs',
      atThresholdUnitId,
      `bucket === rolloutThreshold(42.00) === ${String(threshold42)}`,
    ),
  );
  cases.push(
    computeCase(
      'rollout-0.07-pin',
      'rollout-flag',
      'rs',
      'unit-pin',
      'rollout 0.07 -> threshold 7',
    ),
  );

  // Empty strings.
  cases.push(computeCase('empty-flagkey', '', 's1', 'user-1', 'empty flagKey'));
  cases.push(computeCase('empty-salt', 'flag-1', '', 'user-1', 'empty salt'));
  cases.push(computeCase('empty-unitid', 'flag-1', 's1', '', 'empty unitId'));
  cases.push(computeCase('empty-all', '', '', '', 'all three empty'));

  // Non-ASCII: no trimming/case-folding/Unicode normalization — inputs hashed as received.
  cases.push(
    computeCase('non-ascii-cafe', 'flag-1', 's1', 'café', 'accented Latin (precomposed é)'),
  );
  cases.push(computeCase('non-ascii-nandu', 'flag-1', 's1', 'ñandú', 'accented Latin, ñ + ú'));
  cases.push(computeCase('non-ascii-cjk', 'flag-1', 's1', '日本語', 'CJK'));
  cases.push(
    computeCase('non-ascii-emoji-surrogate-pair', 'flag-1', 's1', '🚀', 'surrogate-pair emoji'),
  );
  cases.push(
    computeCase('non-ascii-emoji-zwj', 'flag-1', 's1', '👩‍💻', 'ZWJ sequence (woman + ZWJ + laptop)'),
  );
  cases.push(
    computeCase(
      'non-ascii-precomposed-e',
      'flag-1',
      's1',
      'é', // é, precomposed (single code point)
      'precomposed é (U+00E9) — pins the no-normalization rule against the decomposed row',
    ),
  );
  cases.push(
    computeCase(
      'non-ascii-decomposed-e',
      'flag-1',
      's1',
      'é', // e + combining acute accent
      'decomposed e + U+0301 — MUST hash/bucket differently than the precomposed row above',
    ),
  );

  // Signed-hash-prone: raw hash has the high bit set (>= 2^31) — exactly what a
  // missing `>>> 0` in the vendored primitive would corrupt.
  const highBitExclude = new Set();
  for (let i = 0; i < 3; i++) {
    const unitId = findUnitIdWithHighBitHash('signed-flag', 'ss', lcg, highBitExclude);
    cases.push(
      computeCase(
        `signed-hash-${String(i)}`,
        'signed-flag',
        'ss',
        unitId,
        'raw hash has the high bit set (>= 2^31)',
      ),
    );
  }

  // Tail branches: UTF-8 byte length of the FULL joined hash input ≡ 0, 1, 2, 3 (mod 4).
  // flagKey='tail', salt='t' -> the fixed prefix "tail:t:" is 7 bytes (≡ 3 mod 4);
  // unitId is padded with ASCII 'x' so `padLength = (remainder + 1) % 4` lands the
  // FULL joined string on the intended remainder exactly.
  for (const remainder of [0, 1, 2, 3]) {
    const padLength = (remainder + 1) % 4;
    const unitId = 'x'.repeat(padLength);
    const joined = `tail:t:${unitId}`;
    const actualRemainder = new TextEncoder().encode(joined).length % 4;
    if (actualRemainder !== remainder) {
      throw new Error(
        `tail-branch case construction bug: wanted remainder ${String(remainder)}, got ${String(actualRemainder)}`,
      );
    }
    cases.push(
      computeCase(
        `tail-branch-mod-${String(remainder)}`,
        'tail',
        't',
        unitId,
        `hash input byte length ≡ ${String(remainder)} (mod 4)`,
      ),
    );
  }

  // Separator ambiguity: a flagKey containing ':' — pins the documented, unfixed
  // limitation that the ':' join separator is unescaped.
  cases.push(
    computeCase(
      'separator-ambiguity',
      'flag:with:colons',
      's1',
      'user-1',
      'flagKey containing ":" — documented limitation, not defended against',
    ),
  );

  // Long input: a 1 KiB unitId.
  cases.push(
    computeCase('long-input-1kib-unitid', 'flag-1', 's1', 'u'.repeat(1024), '1 KiB unitId'),
  );

  return cases;
}

function buildDocument() {
  return {
    algorithm: 'murmur3_x86_32',
    seed: 0,
    totalBuckets: TOTAL_BUCKETS,
    hashInput: '${flagKey}:${salt}:${unitId}',
    generatedBy: 'scripts/generate-vectors.mjs',
    // Static provenance only. Run outcomes (how many cases matched, and when the
    // check last ran) deliberately do NOT live here: a golden file whose bytes
    // change with the calendar is not a golden file, and CI is the real record of
    // when the cross-check last passed.
    crossCheck: {
      script: 'scripts/crosscheck-vectors.mjs',
      tool: 'murmurhash3js-revisited@3.0.0',
    },
    cases: buildCases(),
  };
}

function serialize(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const generated = serialize(buildDocument());

  if (checkOnly) {
    let existing;
    try {
      existing = readFileSync(VECTORS_PATH, 'utf8');
    } catch {
      console.error(
        `vectors:verify — ${VECTORS_PATH} does not exist. Run pnpm vectors:generate first.`,
      );
      process.exitCode = 1;
      return;
    }

    // Byte-for-byte, with no normalization. This generator is the only writer of
    // the fixture — crosscheck-vectors.mjs is strictly read-only — so there is no
    // field that legitimately drifts and therefore nothing to exempt. Any carve-out
    // here would narrow the guarantee this check exists to make.
    if (existing !== generated) {
      console.error(
        'vectors:verify — regenerated vectors differ from the committed fixture. ' +
          'Run pnpm vectors:generate and commit the result.',
      );
      process.exitCode = 1;
      return;
    }

    console.log('vectors:verify — committed vectors.json matches a fresh regeneration.');
    return;
  }

  writeFileSync(VECTORS_PATH, generated);
  console.log(`vectors:generate — wrote ${String(buildCases().length)} cases to ${VECTORS_PATH}`);
}

main();
