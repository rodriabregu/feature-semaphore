/**
 * These live here, not in `application/errors`, because a use case has no
 * business knowing HTTP headers exist — `setErrorHandler` imports both this
 * set and the domain error set.
 */
export class MissingPreconditionError extends Error {
  readonly code = 'missing_precondition' as const;

  constructor() {
    super('If-Match header is required on this route');
    this.name = 'MissingPreconditionError';
  }
}

export class MalformedPreconditionError extends Error {
  readonly code = 'malformed_precondition' as const;

  constructor() {
    super('If-Match does not parse as an integer version');
    this.name = 'MalformedPreconditionError';
  }
}

/**
 * `If-Match: <version>` is not a valid entity-tag as a bare integer, and
 * intermediaries may mangle it, so the three mutating routes emit
 * `ETag: "7"`. This parser accepts `7`, `"7"` and `W/"7"` — strips the
 * wrapper, then requires `/^\d+$/`. Three distinguishable outcomes: absent →
 * `MissingPreconditionError` (428), unparseable → `MalformedPreconditionError`
 * (400), parseable → the version number.
 */
export function parseIfMatch(value: string | number | undefined): number {
  if (value === undefined) {
    throw new MissingPreconditionError();
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new MalformedPreconditionError();
    }
    return value;
  }

  const stripped = value.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  if (!/^\d+$/.test(stripped)) {
    throw new MalformedPreconditionError();
  }
  return Number(stripped);
}

/**
 * `If-None-Match` is a cache OPTIMISATION, not a precondition: an unparseable
 * value degrading to a full 200 is always correct, merely less efficient. A
 * 400 here would break the SDK's polling loop over a header the server can
 * safely ignore — the opposite error policy from `parseIfMatch`. NEVER
 * throws. Splits on commas, strips `W/` and quotes; `*` is returned verbatim
 * as one of the entity-tags, matching everything.
 */
export function parseIfNoneMatch(header: string | undefined): readonly string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (part === '*' ? part : part.replace(/^W\//, '').replace(/^"(.*)"$/, '$1')));
}
