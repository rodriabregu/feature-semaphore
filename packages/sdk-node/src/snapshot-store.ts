import type { Environment, FlagDefinition } from '@rodriab/feature-semaphore-core';

/**
 * Immutable. Replaced by ONE assignment on a successful 200, never mutated
 * in place — so a concurrent `isEnabled()` always observes one coherent
 * snapshot, never a torn read where half the flags are new. `environment`
 * is `undefined` before the first snapshot swap; that is a real, asserted
 * state (see `exposure-batcher.ts`'s pre-snapshot partition), not an
 * oversight.
 */
export interface Snapshot {
  readonly byKey: ReadonlyMap<string, FlagDefinition>;
  readonly etag: string | undefined;
  readonly environment: Environment | undefined;
  readonly fetchedAt: Date;
}

export function buildSnapshot(
  definitions: readonly FlagDefinition[],
  etag: string | undefined,
  environment: Environment,
  fetchedAt: Date,
): Snapshot {
  return {
    byKey: new Map(definitions.map((definition) => [definition.key, definition])),
    etag,
    environment,
    fetchedAt,
  };
}

/** A single mutable cell holding the current snapshot reference. */
export interface SnapshotBox {
  get(): Snapshot | undefined;
  set(next: Snapshot): void;
}

export function createSnapshotBox(initial: Snapshot | undefined): SnapshotBox {
  let current = initial;
  return {
    get: () => current,
    set: (next) => {
      current = next;
    },
  };
}
