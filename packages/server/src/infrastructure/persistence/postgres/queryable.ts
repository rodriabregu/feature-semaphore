/**
 * The minimal shape shared by `pg`'s `Pool`, `PoolClient` and `Client` — enough to
 * run parameterized queries without committing an adapter to one connection kind.
 * The top-level repository binds to a `Pool`; a `UnitOfWork` transaction binds to
 * one `PoolClient` for its whole lifetime.
 */
export interface Queryable {
  // T is caller-specified at each call site (mirrors pg's own `Client.query<T>`
  // signature), not inferred from a parameter — hence it appears once here.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  query<T>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
