import type { EvalContext, TargetingRule } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Returns a boolean for every input and throws for none. Totality is a property of
 * the prelude below, not of the operator table: the operator branches dereference
 * `values[0]` and `actual` freely, safely, only because the prelude has already
 * established that `rule` and `attributes` are objects and that `rule.values` is an
 * array. Any new operator branch may only read a field the prelude has already
 * cleared — adding a branch that reads a new field means adding a prelude guard for
 * it in the same commit.
 */
export function matches(rule: TargetingRule, attributes: EvalContext['attributes']): boolean {
  if (!isRecord(rule)) return false;
  if (!isRecord(attributes)) return false;
  if (!Array.isArray(rule.values)) return false;

  const actual: unknown = attributes[rule.attribute];
  if (actual === undefined || actual === null) return false;

  const values: readonly unknown[] = rule.values;

  switch (rule.operator) {
    case 'in':
      return values.includes(actual);
    case 'not_in':
      return !values.includes(actual);
    case 'contains':
      return (
        typeof values[0] === 'string' && typeof actual === 'string' && actual.includes(values[0])
      );
    case 'starts_with':
      return (
        typeof values[0] === 'string' && typeof actual === 'string' && actual.startsWith(values[0])
      );
    case 'gt':
      return (
        typeof values[0] === 'number' &&
        Number.isFinite(values[0]) &&
        typeof actual === 'number' &&
        Number.isFinite(actual) &&
        actual > values[0]
      );
    case 'lt':
      return (
        typeof values[0] === 'number' &&
        Number.isFinite(values[0]) &&
        typeof actual === 'number' &&
        Number.isFinite(actual) &&
        actual < values[0]
      );
    default:
      return false;
  }
}
