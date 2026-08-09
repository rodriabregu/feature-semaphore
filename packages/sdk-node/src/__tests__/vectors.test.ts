import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluate } from '@rodriab/feature-semaphore-core';
import type { FlagDefinition } from '@rodriab/feature-semaphore-core';

const vectorsPath = fileURLToPath(
  new URL('../../../core/src/__fixtures__/vectors.json', import.meta.url),
);
const exists = existsSync(vectorsPath);

interface VectorCase {
  readonly id: string;
  readonly flagKey: string;
  readonly salt: string;
  readonly unitId: string;
  readonly bucket: number;
}

function buildDefinition(flagKey: string, salt: string, rollout: number): FlagDefinition {
  return {
    key: flagKey,
    environment: 'development',
    archived: false,
    enabled: true,
    onValue: true,
    offValue: false,
    rollout,
    salt,
    rules: [],
    overrides: {},
  };
}

it('the shared golden vectors are where this test expects them', () => {
  expect(exists, 'expected packages/core/src/__fixtures__/vectors.json').toBe(true);
});

// A silent path break becomes the one named failing test above, rather than
// every case here throwing at collection time — this array stays empty (zero
// executed cases, not a false-positive skip) if the fixture is missing.
const fixture: { cases: readonly VectorCase[] } = exists
  ? (JSON.parse(readFileSync(vectorsPath, 'utf8')) as { cases: readonly VectorCase[] })
  : { cases: [] };

describe('golden vectors — sdk-node evaluation matches core bucketing', () => {
  /**
   * The SDK never calls `bucket()` directly — only `evaluate()`. So the
   * meaningful claim is "the SDK's linked copy of core buckets identically
   * to the golden fixture", asserted through the PUBLIC `evaluate()` surface
   * only. Both rollouts below are valid two-decimal values in [0, 100] for
   * every bucket in 0..9999.
   */
  it.each(fixture.cases)(
    'case $id admits at (bucket+1)/100 and excludes at bucket/100',
    (testCase) => {
      const admit = evaluate(
        buildDefinition(testCase.flagKey, testCase.salt, (testCase.bucket + 1) / 100),
        {
          unitId: testCase.unitId,
          attributes: {},
          defaultValue: false,
        },
      );
      expect(admit.value).toBe(true);
      expect(admit.reason).toBe('FALLTHROUGH_ROLLOUT');

      const exclude = evaluate(
        buildDefinition(testCase.flagKey, testCase.salt, testCase.bucket / 100),
        {
          unitId: testCase.unitId,
          attributes: {},
          defaultValue: false,
        },
      );
      expect(exclude.value).toBe(false);
      expect(exclude.reason).toBe('FALLTHROUGH_ROLLOUT');
    },
  );
});
