import { describe, expect, it } from 'vitest';
import {
  CorruptRowError,
  DuplicateKeyError,
  ForbiddenKindError,
  NotFoundError,
  UnauthorizedError,
  VersionConflictError,
  type DomainErrorCode,
} from '../domain-error.js';

describe('domain errors', () => {
  it('NotFoundError is an Error with name and code', () => {
    const error = new NotFoundError('flag', 'x');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NotFoundError');
    expect(error.code).toBe('not_found');
    expect(error.resource).toBe('flag');
    expect(error.identifier).toBe('x');
  });

  it('DuplicateKeyError carries the offending key', () => {
    const error = new DuplicateKeyError('checkout-v2');
    expect(error.name).toBe('DuplicateKeyError');
    expect(error.code).toBe('duplicate_key');
    expect(error.key).toBe('checkout-v2');
  });

  it('VersionConflictError carries expected and actual', () => {
    const error = new VersionConflictError(2, 4);
    expect(error.name).toBe('VersionConflictError');
    expect(error.code).toBe('version_conflict');
    expect(error.expected).toBe(2);
    expect(error.actual).toBe(4);
  });

  it('UnauthorizedError never says which credential failed', () => {
    const error = new UnauthorizedError();
    expect(error.name).toBe('UnauthorizedError');
    expect(error.code).toBe('unauthorized');
  });

  it('ForbiddenKindError is the one live 403', () => {
    const error = new ForbiddenKindError('server', 'admin');
    expect(error.name).toBe('ForbiddenKindError');
    expect(error.code).toBe('forbidden_kind');
    expect(error.kind).toBe('server');
    expect(error.required).toBe('admin');
  });

  it('CorruptRowError carries issue paths, never values', () => {
    const error = new CorruptRowError('targeting_rules', 'row-1', ['values', '0']);
    expect(error.name).toBe('CorruptRowError');
    expect(error.code).toBe('corrupt_row');
    expect(error.table).toBe('targeting_rules');
    expect(error.rowId).toBe('row-1');
    expect(error.issuePaths).toEqual(['values', '0']);
  });

  it('regression guard: forbidden_environment cannot be reintroduced as a DomainErrorCode', () => {
    // @ts-expect-error — 'forbidden_environment' is not a member of DomainErrorCode.
    // The management API is not environment-scoped by credential (rev 2, D1-D6).
    const code: DomainErrorCode = 'forbidden_environment';
    expect(code).toBeDefined();
  });
});
