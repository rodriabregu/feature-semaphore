// 'forbidden_environment' is GONE (rev 2). The management API takes its environment
// from the :env path parameter, not from the credential; per-key environment scoping
// is the SDK API's rule and arrives in Phase 3. Re-adding it here is a compile error
// by design — see the regression-guard test in __tests__/domain-error.test.ts.
export type DomainErrorCode =
  | 'not_found'
  | 'duplicate_key'
  | 'version_conflict'
  | 'unauthorized'
  | 'forbidden_kind'
  | 'corrupt_row';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found' as const;

  constructor(
    readonly resource: string,
    readonly identifier: string,
  ) {
    super(`${resource} not found: ${identifier}`);
  }
}

export class DuplicateKeyError extends DomainError {
  readonly code = 'duplicate_key' as const;

  constructor(readonly key: string) {
    super(`flag key already exists: ${key}`);
  }
}

export class VersionConflictError extends DomainError {
  readonly code = 'version_conflict' as const;

  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`version conflict: expected ${expected}, actual ${actual}`);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'unauthorized' as const;

  constructor() {
    super('missing or invalid credentials'); // never says WHICH
  }
}

/** The ONE live 403: kind enforcement. "Two APIs, two audiences, two keys." */
export class ForbiddenKindError extends DomainError {
  readonly code = 'forbidden_kind' as const;

  constructor(
    readonly kind: string,
    readonly required: string,
  ) {
    super(`key kind ${kind} cannot use a ${required} route`);
  }
}

export class CorruptRowError extends DomainError {
  readonly code = 'corrupt_row' as const;

  /** `issuePaths` only — never the offending values, which may be user attributes. */
  constructor(
    readonly table: string,
    readonly rowId: string,
    readonly issuePaths: readonly string[],
  ) {
    super(`persisted row failed its decoder: ${table}#${rowId}`);
  }
}
