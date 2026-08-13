import type { ReactElement } from 'react';
import type { LastModified } from './last-modified.js';

export interface FlagListRowData {
  readonly key: string;
  readonly development: { readonly enabled: boolean; readonly rolloutPercentage: number };
  readonly production: { readonly enabled: boolean; readonly rolloutPercentage: number };
  readonly lastModified: LastModified;
  readonly evaluations24h: number;
}

export interface FlagListViewProps {
  readonly rows: readonly FlagListRowData[];
}

function environmentState(state: { enabled: boolean; rolloutPercentage: number }): string {
  return `${state.enabled ? 'On' : 'Off'} · ${state.rolloutPercentage}%`;
}

function formatLastModified(lastModified: LastModified): string {
  return `${new Date(lastModified.at).toLocaleString()} (${lastModified.environment})`;
}

/**
 * Presentational (D4/D3): pure, prop-driven, does no fetching — `FlagListPage`
 * (the container) owns every query. Renders exactly the columns the spec
 * requires: key, per-environment state (enabled + rollout %), last modified
 * (labelled by its source environment), and the combined 24h evaluation
 * count.
 */
export function FlagListView({ rows }: FlagListViewProps): ReactElement {
  return (
    <table>
      <caption>Flags</caption>
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">Development</th>
          <th scope="col">Production</th>
          <th scope="col">Last modified</th>
          <th scope="col">Evaluations (24h)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.key}</th>
            <td>{environmentState(row.development)}</td>
            <td>{environmentState(row.production)}</td>
            <td>{formatLastModified(row.lastModified)}</td>
            <td>{row.evaluations24h}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
