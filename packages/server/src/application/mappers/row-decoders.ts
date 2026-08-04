import { z } from 'zod';
import type { TargetingRule } from '@rodriab/feature-semaphore-core';
import { CorruptRowError } from '../errors/domain-error.js';

const attributeValue = z.union([z.string(), z.number(), z.boolean()]);
const base = { attribute: z.string(), serve: z.boolean(), rollout: z.number().min(0).max(100) };

const targetingRuleSchema = z.discriminatedUnion('operator', [
  z.object({
    ...base,
    operator: z.enum(['in', 'not_in']),
    values: z.array(attributeValue).readonly(),
  }),
  z.object({
    ...base,
    operator: z.enum(['contains', 'starts_with']),
    values: z.tuple([z.string()]).readonly(),
  }),
  z.object({
    ...base,
    operator: z.enum(['gt', 'lt']),
    values: z.tuple([z.number()]).readonly(),
  }),
]) satisfies z.ZodType<TargetingRule>;

/**
 * @throws CorruptRowError when a persisted rule does not decode to core's
 * `TargetingRule` union. The error carries Zod issue PATHS, never the offending
 * values — those may carry user attributes.
 */
export function decodeRule(row: unknown, rowId = 'unknown'): TargetingRule {
  const result = targetingRuleSchema.safeParse(row);
  if (!result.success) {
    const issuePaths = result.error.issues.map((issue) => issue.path.join('.'));
    throw new CorruptRowError('targeting_rules', rowId, issuePaths);
  }
  return result.data;
}
