/**
 * Every TanStack Query key lives here, once — a key spelled inline in
 * `invalidateQueries` elsewhere is a silent no-op (design D4). The screens
 * that consume these land in later slices (D3+); this module only fixes the
 * shape their keys take, so no later slice spells one out twice.
 */
export const queryKeys = {
  flags: () => ['flags'] as const,
  flag: (flagKey: string) => ['flags', flagKey] as const,
  exposures: (environment: string) => ['exposures', environment] as const,
  audit: (flagKey: string) => ['flags', flagKey, 'audit'] as const,
} as const;
