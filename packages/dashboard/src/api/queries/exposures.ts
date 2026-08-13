import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '../client.js';
import { queryKeys } from '../query-keys.js';
import type { Environment, ExposuresTotalsResponse } from '../types.js';

/**
 * `since` is deliberately NEVER passed — the server defaults it to exactly
 * 24h ago (`packages/server/.../schemas/exposures.ts`), so every row's 24h
 * window stays server-authoritative and identical across every flag. One
 * call per environment, never per flag — the requirement this hook exists to
 * satisfy (spec "N flags, two exposure calls").
 */
export function useExposuresQuery(
  environment: Environment,
): UseQueryResult<ExposuresTotalsResponse> {
  return useQuery({
    queryKey: queryKeys.exposures(environment),
    queryFn: () => apiFetch<ExposuresTotalsResponse>(`/api/exposures?env=${environment}`),
  });
}
