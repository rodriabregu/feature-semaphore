import type { FlagDefinition } from '@rodriab/feature-semaphore-core';
import { describe, expect, it } from 'vitest';
import { canonicalString, definitionsEtag, sortDefinitions } from '../definitions-etag.js';

function def(overrides: Partial<FlagDefinition> = {}): FlagDefinition {
  return {
    key: overrides.key ?? 'flag',
    environment: 'development',
    archived: false,
    enabled: true,
    onValue: true,
    offValue: false,
    rollout: 0,
    salt: 's1',
    rules: [],
    overrides: {},
    ...overrides,
  };
}

function etagOf(defs: readonly FlagDefinition[]): string {
  return definitionsEtag(canonicalString(sortDefinitions(defs), 'development'));
}

describe('canonical definitions ETag', () => {
  it('two definition arrays differing only in element order produce an identical ETag', () => {
    const a = def({ key: 'checkout-v2' });
    const b = def({ key: 'beta-banner' });

    expect(etagOf([a, b])).toBe(etagOf([b, a]));
  });

  it('overrides built by different insertion orders, including a mixed integer/string key set, produce an identical ETag', () => {
    const overridesA = { alice: true, bob: false, '42': true, '7': false };
    const overridesB = { bob: false, '7': false, alice: true, '42': true };

    const a = def({ key: 'checkout-v2', overrides: overridesA });
    const b = def({ key: 'checkout-v2', overrides: overridesB });

    expect(etagOf([a])).toBe(etagOf([b]));
  });

  it('reordering rules CHANGES the ETag — rule order is semantic and never normalised away', () => {
    const ruleA = {
      attribute: 'plan',
      operator: 'in' as const,
      values: ['pro'],
      serve: true,
      rollout: 100,
    };
    const ruleB = {
      attribute: 'plan',
      operator: 'in' as const,
      values: ['team'],
      serve: false,
      rollout: 100,
    };

    const forward = def({ key: 'checkout-v2', rules: [ruleA, ruleB] });
    const reversed = def({ key: 'checkout-v2', rules: [ruleB, ruleA] });

    expect(etagOf([forward])).not.toBe(etagOf([reversed]));
  });

  it("the worked example's canonical string matches character-for-character", () => {
    const betaBanner = def({ key: 'beta-banner', enabled: false, salt: 's2' });
    const checkoutV2 = def({
      key: 'checkout-v2',
      rollout: 33.33,
      salt: 's1',
      rules: [
        { attribute: 'plan', operator: 'in', values: ['pro', 'team'], serve: true, rollout: 100 },
      ],
      overrides: { alice: true, bob: false, '42': true, '7': false },
    });

    const canonical = canonicalString(sortDefinitions([checkoutV2, betaBanner]), 'development');

    expect(canonical).toBe(
      '["fs-defs/1","development",[["beta-banner","development",false,false,true,false,0,"s2",[],[]],["checkout-v2","development",false,true,true,false,33.33,"s1",[["plan","in",["pro","team"],true,100]],[["42",true],["7",false],["alice",true],["bob",false]]]]]',
    );
  });
});
