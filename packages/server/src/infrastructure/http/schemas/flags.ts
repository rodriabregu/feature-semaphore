import { z } from 'zod';
import { environmentSchema } from './environment.js';
import { rolloutSchema } from './rollout.js';

/** `^[a-z0-9][a-z0-9-]{1,63}$` — lowercase, digits, hyphens, 2-64 characters. */
export const flagKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);

export const flagKeyParams = z.object({ key: flagKeySchema }).strict();

/** `:env` is validated here, as an enum — an unrecognised value is 400, never 403. */
export const configParams = z.object({ key: flagKeySchema, env: environmentSchema }).strict();

export const createFlagBody = z
  .object({
    key: flagKeySchema,
    name: z.string().min(1),
    description: z.string().default(''),
  })
  .strict();

/**
 * `salt` is deliberately absent: it is generated once per (flag, environment)
 * at creation and is not patchable — a body carrying it is rejected by
 * `.strict()`, never silently ignored.
 */
export const updateConfigBody = z
  .object({
    enabled: z.boolean().optional(),
    off_value: z.boolean().optional(),
    on_value: z.boolean().optional(),
    rollout_percentage: rolloutSchema.optional(),
  })
  .strict();

const attributeValue = z.union([z.string(), z.number(), z.boolean()]);
const ruleBase = { attribute: z.string().min(1), serve: z.boolean(), rollout: rolloutSchema };

/**
 * `.strict()` is applied to EACH member individually — it does not exist on
 * `ZodDiscriminatedUnion` itself (only its members can be strictified). Without
 * this, an unknown key such as `salt` inside a rule is silently stripped
 * rather than rejected, both here and on the shipped `PUT .../rules` route
 * that reuses this schema.
 */
export const targetingRuleBody = z.discriminatedUnion('operator', [
  z
    .object({ ...ruleBase, operator: z.enum(['in', 'not_in']), values: z.array(attributeValue) })
    .strict(),
  z
    .object({
      ...ruleBase,
      operator: z.enum(['contains', 'starts_with']),
      values: z.tuple([z.string()]),
    })
    .strict(),
  z.object({ ...ruleBase, operator: z.enum(['gt', 'lt']), values: z.tuple([z.number()]) }).strict(),
]);

export const replaceRulesBody = z.object({ rules: z.array(targetingRuleBody) }).strict();

export const overrideBody = z.object({ unit_id: z.string().min(1), serve: z.boolean() }).strict();
export const replaceOverridesBody = z.object({ overrides: z.array(overrideBody) }).strict();

export const auditQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(500).default(50) })
  .strict();
