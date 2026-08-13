import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '../client.js';
import { queryKeys } from '../query-keys.js';
import type { FlagWire } from '../types.js';

/**
 * Populates the exact same cache entry `useVersionedMutation` reads its
 * `version` from at mutation time (`queryKeys.flag(flagKey)`) — the detail
 * screen's own read query IS the cache the shared hook depends on.
 */
export function useFlagQuery(flagKey: string): UseQueryResult<FlagWire> {
  return useQuery({
    queryKey: queryKeys.flag(flagKey),
    queryFn: () => apiFetch<FlagWire>(`/api/flags/${flagKey}`),
    enabled: flagKey.length > 0,
  });
}
