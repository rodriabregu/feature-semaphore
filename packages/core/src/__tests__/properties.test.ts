import { describe, expect, it, vi } from 'vitest';
import { bucket, rolloutThreshold } from '../bucketing.js';
import { evaluate } from '../evaluate.js';
import type { EvalContext, FlagDefinition } from '../types.js';

/**
 * These five properties are CPU-bound by design — the monotonicity case alone
 * computes a million buckets (10,000 unit ids x 100 rollout levels), and the
 * distribution cases hash 100,000 each. Sample sizes are the whole point: they
 * are what make a distribution claim meaningful, so they must never be trimmed
 * to fit a clock.
 *
 * The default 5s budget was ample when this file ran alongside ~20 others. It
 * is not a property of this test that changed, but the parallel load around it:
 * the workspace suite crossed 80 files and monotonicity began timing out at
 * ~5.6s under contention while still finishing in 2.5s in isolation. This
 * timeout is sized for a loaded machine, not for the work itself.
 */
vi.setConfig({ testTimeout: 30_000 });

/** `s = (s * 1664525 + 1013904223) mod 2^32` — matches scripts/generate-vectors.mjs's LCG. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

const baseDef: FlagDefinition = {
  key: 'properties-flag',
  environment: 'production',
  archived: false,
  enabled: true,
  onValue: true,
  offValue: false,
  rollout: 50,
  salt: 'properties-salt',
  rules: [],
  overrides: {},
};

function ctxFor(unitId: string): EvalContext {
  return { unitId, attributes: {}, defaultValue: false };
}

describe('property: determinism', () => {
  it('evaluate() is identical across 10,000 repeated calls for the same (def, ctx)', () => {
    const context = ctxFor('deterministic-user');
    const first = evaluate(baseDef, context);
    for (let i = 0; i < 10_000; i++) {
      expect(evaluate(baseDef, context)).toEqual(first);
    }
  });

  it('bucket() is stable across 10,000 repeated calls for the same inputs', () => {
    const first = bucket('properties-flag', 'properties-salt', 'deterministic-user');
    for (let i = 0; i < 10_000; i++) {
      expect(bucket('properties-flag', 'properties-salt', 'deterministic-user')).toBe(first);
    }
  });
});

describe('property: distribution', () => {
  it('50% rollout admits within ±1% of 100,000 index-derived unit ids', () => {
    const total = 100_000;
    let admitted = 0;
    for (let i = 0; i < total; i++) {
      if (evaluate(baseDef, ctxFor(`unit-${String(i)}`)).value) admitted++;
    }
    const ratio = admitted / total;
    expect(ratio).toBeGreaterThanOrEqual(0.49);
    expect(ratio).toBeLessThanOrEqual(0.51);
  });

  it('50% rollout admits within ±1% of 100,000 seeded-LCG-derived unit ids', () => {
    const total = 100_000;
    const lcg = makeLcg(0x1234_5678);
    let admitted = 0;
    for (let i = 0; i < total; i++) {
      const unitId = `lcg-${lcg().toString(16)}`;
      if (evaluate(baseDef, ctxFor(unitId)).value) admitted++;
    }
    const ratio = admitted / total;
    expect(ratio).toBeGreaterThanOrEqual(0.49);
    expect(ratio).toBeLessThanOrEqual(0.51);
  });
});

describe('property: monotonicity (non-strict superset)', () => {
  it('raising rollout from X% to Y% (Y>X) never removes a unit id that was inside at X%', () => {
    const unitIds = Array.from({ length: 10_000 }, (_, i) => `mono-${String(i)}`);
    const inSetByRollout = new Map<number, Set<string>>();

    for (let rollout = 1; rollout <= 100; rollout++) {
      const threshold = rolloutThreshold(rollout);
      const inSet = new Set<string>();
      for (const unitId of unitIds) {
        if (bucket(baseDef.key, baseDef.salt, unitId) < threshold) inSet.add(unitId);
      }
      inSetByRollout.set(rollout, inSet);
    }

    for (let x = 1; x < 100; x++) {
      const inSetAtX = inSetByRollout.get(x);
      const inSetAtY = inSetByRollout.get(x + 1);
      if (!inSetAtX || !inSetAtY) throw new Error('unreachable: rollout range constructed above');
      // Non-strict: every id inside at X remains inside at X+1. Deliberately NOT
      // asserting inSetAtY.size > inSetAtX.size — a strict-subset assertion would
      // additionally require every band to be non-empty, which the spec does not
      // require.
      for (const id of inSetAtX) {
        expect(inSetAtY.has(id)).toBe(true);
      }
    }
  });
});
