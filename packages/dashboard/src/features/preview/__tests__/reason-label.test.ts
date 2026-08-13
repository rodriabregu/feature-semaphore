import { describe, expect, it } from 'vitest';
import type { EvaluationReason } from '@rodriab/feature-semaphore-core';
import { reasonLabel } from '../reason-label.js';

describe('reasonLabel — human-readable evaluation reason (row 60)', () => {
  it.each<[EvaluationReason, string]>([
    ['FLAG_NOT_FOUND', 'Flag not found'],
    ['FLAG_ARCHIVED', 'Flag archived'],
    ['FLAG_OFF', 'Flag disabled'],
    ['OVERRIDE', 'Unit override applied'],
    ['FALLTHROUGH_ROLLOUT', 'Fell through to the default rollout'],
  ])('renders %s as prose: %s', (reason, expected) => {
    expect(reasonLabel(reason)).toBe(expected);
  });

  it('renders RULE_MATCH:<n> with its rule index, never the raw enum token', () => {
    const label = reasonLabel('RULE_MATCH:2');
    expect(label).not.toContain('RULE_MATCH:2');
    expect(label).toContain('2');
  });

  it('renders RULE_ROLLOUT:<n> with its rule index, never the raw enum token', () => {
    const label = reasonLabel('RULE_ROLLOUT:5');
    expect(label).not.toContain('RULE_ROLLOUT:5');
    expect(label).toContain('5');
  });
});
