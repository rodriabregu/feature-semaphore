import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '../client.js';
import { queryKeys } from '../query-keys.js';
import type { FlagListResponse } from '../types.js';

/**
 * `[I]` `GET /flags` emits no `ETag` (design D4's "Two corrections to the
 * proposal"), so this is a plain refetch with no bandwidth saving — not a
 * real optimisation, recorded honestly rather than implied as one.
 */
const FLAGS_REFETCH_INTERVAL_MS = 30_000;

export function useFlagsQuery(): UseQueryResult<FlagListResponse> {
  return useQuery({
    queryKey: queryKeys.flags(),
    queryFn: () => apiFetch<FlagListResponse>('/api/flags'),
    refetchInterval: FLAGS_REFETCH_INTERVAL_MS,
  });
}
