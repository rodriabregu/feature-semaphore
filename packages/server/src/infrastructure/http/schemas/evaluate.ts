import { z } from 'zod';
import { environmentSchema } from './environment.js';
import { flagKeySchema, overrideBody, targetingRuleBody } from './flags.js';
import { rolloutSchema } from './rollout.js';

/**
 * L2c — OPEN by design, deliberately NOT `.strict()`-adjacent. An application
 * attribute may legitimately be named `salt`; it is user data that flows into
 * `EvalContext.attributes` and can never reach a `FlagDefinition` field.
 */
const attributesSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

const previewContext = z
  .object({
    unit_id: z.string().min(1),
    attributes: attributesSchema.default({}),
    default_value: z.boolean(),
  })
  .strict();

/**
 * Every field optional. `salt`, `version`, `archived`, `key` and `environment`
 * are ABSENT from this shape, so `.strict()` turns any of them into a 400
 * rather than a silent strip.
 */
const candidateBody = z
  .object({
    enabled: z.boolean().optional(),
    on_value: z.boolean().optional(),
    off_value: z.boolean().optional(),
    rollout_percentage: rolloutSchema.optional(),
    rules: z.array(targetingRuleBody).optional(), // reused verbatim — never re-declared
    overrides: z.array(overrideBody).optional(),
  })
  .strict();

export const previewBody = z
  .object({
    flag_key: flagKeySchema,
    environment: environmentSchema,
    context: previewContext,
    candidate: candidateBody.optional(),
  })
  .strict();

export type PreviewBody = z.infer<typeof previewBody>;
