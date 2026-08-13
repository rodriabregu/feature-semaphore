import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '../client.js';
import { queryKeys } from '../query-keys.js';
import type { AuditResponse } from '../types.js';

/**
 * `limit` is capped and defaulted server-side (`auditQuery` schema, 1-500,
 * default 50) — this hook forwards whatever the caller resolved, never
 * re-implements the cap, and appends `limit` to the canonical
 * `queryKeys.audit` prefix rather than spelling a second key inline.
 */
export function useAuditQuery(flagKey: string, limit: number): UseQueryResult<AuditResponse> {
  return useQuery({
    queryKey: [...queryKeys.audit(flagKey), limit],
    queryFn: () => apiFetch<AuditResponse>(`/api/flags/${flagKey}/audit?limit=${limit}`),
    enabled: flagKey.length > 0,
  });
}
