import type { EvaluationReason } from '@rodriab/feature-semaphore-core';

const RULE_MATCH_PATTERN = /^RULE_MATCH:(\d+)$/;
const RULE_ROLLOUT_PATTERN = /^RULE_ROLLOUT:(\d+)$/;

/**
 * The fixed (non-templated) reasons. A `Record` over every member of this
 * type minus the two templated ones is a compile-time exhaustiveness check —
 * a new fixed reason added to `EvaluationReason` without an entry here is a
 * type error, not a silently-unhandled case.
 */
const FIXED_REASON_LABELS: Record<
  Exclude<EvaluationReason, `RULE_MATCH:${number}` | `RULE_ROLLOUT:${number}`>,
  string
> = {
  FLAG_NOT_FOUND: 'Flag not found',
  FLAG_ARCHIVED: 'Flag archived',
  FLAG_OFF: 'Flag disabled',
  OVERRIDE: 'Unit override applied',
  FALLTHROUGH_ROLLOUT: 'Fell through to the default rollout',
};

/**
 * The whole point of the preview screen (design D6, spec "Preview screen
 * shows value and reason", ladder row 60): `RULE_MATCH:${n}` and
 * `RULE_ROLLOUT:${n}` render with their rule index in prose, never the raw
 * enum token a reason like `FLAG_OFF` would otherwise be indistinguishable
 * from if left unrendered.
 */
export function reasonLabel(reason: EvaluationReason): string {
  const ruleMatch = RULE_MATCH_PATTERN.exec(reason);
  if (ruleMatch) {
    return `Matched rule ${ruleMatch[1]}`;
  }
  const ruleRollout = RULE_ROLLOUT_PATTERN.exec(reason);
  if (ruleRollout) {
    return `Rule ${ruleRollout[1]} rollout miss — fell through`;
  }
  return FIXED_REASON_LABELS[reason as keyof typeof FIXED_REASON_LABELS];
}
