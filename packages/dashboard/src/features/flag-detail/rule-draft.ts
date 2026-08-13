import type { RuleWire } from '../../api/types.js';

/** Matches `packages/server/src/infrastructure/http/schemas/flags.ts`'s `targetingRuleBody`. */
export type RuleOperator = 'in' | 'not_in' | 'contains' | 'starts_with' | 'gt' | 'lt';

export const RULE_OPERATORS: readonly RuleOperator[] = [
  'in',
  'not_in',
  'contains',
  'starts_with',
  'gt',
  'lt',
];

/**
 * A form-editable draft of one rule. `valuesInput` is always a single text
 * field — its meaning depends on `operator` (design D5's mirrored shape
 * constraint): a comma-separated list for `in`/`not_in`, or a single raw
 * value otherwise. Never persisted directly; see `draftToWireRule`.
 */
export interface RuleDraft {
  readonly attribute: string;
  readonly operator: RuleOperator;
  readonly valuesInput: string;
  readonly serve: boolean;
  readonly rollout: number;
}

function valuesToInput(operator: RuleOperator, values: readonly unknown[]): string {
  if (operator === 'in' || operator === 'not_in') {
    return values.map(String).join(', ');
  }
  return values.length > 0 ? String(values[0]) : '';
}

export function draftFromWire(rule: RuleWire): RuleDraft {
  const operator = rule.operator as RuleOperator;
  return {
    attribute: rule.attribute,
    operator,
    valuesInput: valuesToInput(operator, rule.values),
    serve: rule.serve,
    rollout: rule.rollout,
  };
}

/**
 * Server shape per operator (`schemas/flags.ts`'s `targetingRuleBody`):
 * `in`/`not_in` → an array of any length; `contains`/`starts_with` → exactly
 * one string; `gt`/`lt` → exactly one number. Returns `undefined` when
 * `valuesInput` cannot satisfy that shape, so the form can block Save
 * before the server ever sees an invalid body.
 */
function parseValues(operator: RuleOperator, valuesInput: string): readonly unknown[] | undefined {
  const trimmed = valuesInput.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  switch (operator) {
    case 'in':
    case 'not_in':
      return trimmed
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    case 'contains':
    case 'starts_with':
      return [trimmed];
    case 'gt':
    case 'lt': {
      const asNumber = Number(trimmed);
      return Number.isFinite(asNumber) ? [asNumber] : undefined;
    }
  }
}

export function isValidRuleDraft(draft: RuleDraft): boolean {
  if (draft.attribute.trim().length === 0) {
    return false;
  }
  if (draft.rollout < 0 || draft.rollout > 100) {
    return false;
  }
  return parseValues(draft.operator, draft.valuesInput) !== undefined;
}

/** Converts a valid draft to the exact PUT-body shape. Callers MUST gate on `isValidRuleDraft` first. */
export function draftToWireRule(draft: RuleDraft): RuleWire {
  const values = parseValues(draft.operator, draft.valuesInput);
  if (values === undefined) {
    throw new Error(`Cannot serialise an invalid rule draft for attribute "${draft.attribute}".`);
  }
  return {
    attribute: draft.attribute,
    operator: draft.operator,
    values,
    serve: draft.serve,
    rollout: draft.rollout,
  };
}
