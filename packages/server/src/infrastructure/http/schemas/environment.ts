import { z } from 'zod';

/**
 * `:env` is validated HERE and nowhere else. An unrecognised value is a 400
 * `validation_failed`, never a 403 — 400 means "that is not an environment",
 * 403 means "your key is the wrong kind of key".
 */
export const environmentSchema = z.enum(['development', 'production']);
