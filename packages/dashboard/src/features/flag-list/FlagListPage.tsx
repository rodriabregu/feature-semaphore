import type { ReactElement } from 'react';
import { useFlagsQuery } from '../../api/queries/flags.js';
import { useExposuresQuery } from '../../api/queries/exposures.js';
import { lastModified } from './last-modified.js';
import { FlagListView, type FlagListRowData } from './FlagListView.js';

/**
 * Container (D3): the only place this screen fetches. Exactly two exposure
 * queries exist here — one per environment — regardless of flag count, which
 * is what makes the spec's "no N+1" requirement true by construction: adding
 * an 11th flag adds a row, never a 3rd request.
 */
export function FlagListPage(): ReactElement {
  const flagsQuery = useFlagsQuery();
  const developmentExposures = useExposuresQuery('development');
  const productionExposures = useExposuresQuery('production');

  if (flagsQuery.isPending || developmentExposures.isPending || productionExposures.isPending) {
    return <p>Loading flags…</p>;
  }
  if (flagsQuery.isError) {
    return <p role="alert">Failed to load flags.</p>;
  }

  const developmentTotals = new Map(
    developmentExposures.data?.flags.map((f) => [f.flag_key, f.total]) ?? [],
  );
  const productionTotals = new Map(
    productionExposures.data?.flags.map((f) => [f.flag_key, f.total]) ?? [],
  );

  const rows: FlagListRowData[] = flagsQuery.data.flags.map((flag) => ({
    key: flag.key,
    development: {
      enabled: flag.environments.development.enabled,
      rolloutPercentage: flag.environments.development.rollout_percentage,
    },
    production: {
      enabled: flag.environments.production.enabled,
      rolloutPercentage: flag.environments.production.rollout_percentage,
    },
    lastModified: lastModified(flag),
    evaluations24h: (developmentTotals.get(flag.key) ?? 0) + (productionTotals.get(flag.key) ?? 0),
  }));

  return (
    <>
      <h1>Flags</h1>
      <FlagListView rows={rows} />
    </>
  );
}
