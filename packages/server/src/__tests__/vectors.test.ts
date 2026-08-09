import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluate } from '@rodriab/feature-semaphore-core';
import type { FlagDefinition } from '@rodriab/feature-semaphore-core';

// Closes the golden-vector three-way claim's server leg — before this file, no
// vitest test in ANY package read this fixture (see design's E1 finding).
const vectorsPath = fileURLToPath(
  new URL('../../../core/src/__fixtures__/vectors.json', import.meta.url),
);

it('the shared golden vectors are where this test expects them', () => {
  expect(existsSync(vectorsPath), 'expected packages/core/src/__fixtures__/vectors.json').toBe(
    true,
  );
});

interface VectorCase {
  readonly id: string;
  readonly flagKey: string;
  readonly salt: string;
  readonly unitId: string;
  readonly bucket: number;
}

const fixture = existsSync(vectorsPath)
  ? (JSON.parse(readFileSync(vectorsPath, 'utf8')) as { cases: readonly VectorCase[] })
  : { cases: [] };

describe('golden vectors — server evaluation matches core bucketing', () => {
  it.each(fixture.cases)(
    'case $id admits at (bucket+1)/100, excludes at bucket/100',
    (testCase) => {
      const definition: FlagDefinition = {
        key: testCase.flagKey,
        environment: 'development',
        archived: false,
        enabled: true,
        onValue: true,
        offValue: false,
        rollout: (testCase.bucket + 1) / 100,
        salt: testCase.salt,
        rules: [],
        overrides: {},
      };
      const ctx = { unitId: testCase.unitId, attributes: {}, defaultValue: false };

      expect(evaluate(definition, ctx)).toEqual({ value: true, reason: 'FALLTHROUGH_ROLLOUT' });
      expect(evaluate({ ...definition, rollout: testCase.bucket / 100 }, ctx)).toEqual({
        value: false,
        reason: 'FALLTHROUGH_ROLLOUT',
      });
    },
  );
});
