import { z } from 'zod';

/**
 * `multipleOf` uses zod's decimal-shift implementation, not a naive modulo:
 * verified to accept 0.07/0.03/0.29/12.34/99.99 and reject 0.005. 3+ decimals
 * are rejected with 400, never rounded — `33.333` throws.
 */
export const rolloutSchema = z.number().min(0).max(100).multipleOf(0.01);
