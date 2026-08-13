import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../client.js';
import { queryKeys } from '../query-keys.js';
import type { Environment, FlagWire } from '../types.js';

export interface ConfigRef {
  readonly flagKey: string;
  readonly environment: Environment;
}

/** The mutation response body is `{version}` only (`config.routes.ts:34`). */
export interface VersionResponse {
  readonly version: number;
}

export interface VersionedMutationSpec {
  readonly method: 'PATCH' | 'PUT';
  readonly path: (ref: ConfigRef) => string;
}

/**
 * Thrown when `ref`'s query cache holds no version at mutation time. Never
 * guessed, never sent as `if-match: 0` — an absent version means the flag
 * detail query hasn't populated the cache yet, and mutating without a real
 * version would either 428 upstream or, worse, be interpreted as "no
 * precondition" (design D4, spec "Concurrent edit surfaces conflict").
 */
export class StaleCacheError extends Error {
  readonly ref: ConfigRef;

  constructor(ref: ConfigRef) {
    super(
      `No cached version for ${ref.flagKey}/${ref.environment} — refusing to mutate without one.`,
    );
    this.name = 'StaleCacheError';
    this.ref = ref;
  }
}

/**
 * The ONE mutation pattern every mutating dashboard screen uses (design D4,
 * spec "Concurrent edit surfaces conflict, never silent overwrite"). Every
 * later mutating screen goes through this hook — there is no second
 * mutation pattern.
 *
 * `version` is NEVER a parameter and NEVER a prop: it is read from the query
 * cache inside `mutationFn`, one line before the request leaves. A version
 * captured earlier — e.g. in a presentational component's props at render
 * time — is stale by construction and would either manufacture a spurious
 * 412 or, worse, invite a naive retry that overwrites a concurrent change.
 */
export function useVersionedMutation<TBody>(
  ref: ConfigRef,
  spec: VersionedMutationSpec,
): UseMutationResult<VersionResponse, ApiError | StaleCacheError, TBody> {
  const queryClient = useQueryClient();

  return useMutation<VersionResponse, ApiError | StaleCacheError, TBody>({
    retry: false, // written explicitly — retrying a 412 by re-reading the version IS the silent overwrite this hook exists to prevent
    mutationFn: async (body: TBody) => {
      const flag = queryClient.getQueryData<FlagWire>(queryKeys.flag(ref.flagKey));
      const version = flag?.environments[ref.environment].version;
      if (version === undefined) {
        throw new StaleCacheError(ref);
      }
      return apiFetch<VersionResponse>(spec.path(ref), {
        method: spec.method,
        headers: { 'if-match': String(version), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      // The response is `{version}` only — writing just the version via
      // `setQueryData` would leave `rules`/`overrides` stale after e.g. a
      // `PUT .../rules`, so this invalidates and lets a real refetch happen.
      void queryClient.invalidateQueries({ queryKey: queryKeys.flag(ref.flagKey) });
    },
    onError: (error) => {
      // A 412 never auto-resolves: invalidate so the operator sees the real
      // current state, and let the caller read `error.problem.actualVersion`
      // to render the conflict. Never retried — `retry: false` above.
      if (error instanceof ApiError && error.problem.status === 412) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.flag(ref.flagKey) });
      }
    },
  });
}
