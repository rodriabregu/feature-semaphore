import type { ReactElement } from 'react';

/**
 * Placeholder landing content rendered inside `Shell`'s main landmark (D2).
 * The real flag-list screen is D3's scope — this component owns no data
 * fetching and no container behaviour, only somewhere for the root route to
 * point while D2 wires the shell and routing.
 */
export function DashboardHome(): ReactElement {
  return (
    <>
      <h1>Feature Semaphore</h1>
      <p>Screens land in later slices.</p>
    </>
  );
}
