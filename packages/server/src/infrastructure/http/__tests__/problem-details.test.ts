import { describe, expect, it } from 'vitest';
import type { DomainErrorCode } from '../../../application/errors/domain-error.js';
import { PROBLEM_BY_CODE, type ProblemCode } from '../problem-details.js';

const DOMAIN_ERROR_CODES: readonly DomainErrorCode[] = [
  'not_found',
  'duplicate_key',
  'version_conflict',
  'unauthorized',
  'forbidden_kind',
  'corrupt_row',
];

describe('PROBLEM_BY_CODE', () => {
  it('has an entry for every ProblemCode, including every DomainErrorCode', () => {
    for (const code of DOMAIN_ERROR_CODES) {
      expect(PROBLEM_BY_CODE[code as ProblemCode]).toBeDefined();
    }
    for (const code of [
      'validation_failed',
      'missing_precondition',
      'malformed_precondition',
      'internal',
    ] as const) {
      expect(PROBLEM_BY_CODE[code]).toBeDefined();
    }
  });

  it('409, 412 and 428 are three distinct statuses with three distinct type URIs', () => {
    const conflict = PROBLEM_BY_CODE.duplicate_key;
    const versionConflict = PROBLEM_BY_CODE.version_conflict;
    const missing = PROBLEM_BY_CODE.missing_precondition;

    expect(conflict.status).toBe(409);
    expect(versionConflict.status).toBe(412);
    expect(missing.status).toBe(428);

    const types = new Set([conflict.type, versionConflict.type, missing.type]);
    expect(types.size).toBe(3);
  });

  it('there is exactly one 403 entry — forbidden_kind', () => {
    const entries = Object.entries(PROBLEM_BY_CODE);
    const forbidden = entries.filter(([, spec]) => spec.status === 403);
    expect(forbidden).toHaveLength(1);
    expect(forbidden[0]?.[0]).toBe('forbidden_kind');
  });

  it('has no forbidden_environment entry', () => {
    expect(Object.keys(PROBLEM_BY_CODE)).not.toContain('forbidden_environment');
  });
});
