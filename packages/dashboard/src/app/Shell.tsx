import type { ReactElement, ReactNode } from 'react';
import { SkipLink } from '../components/atoms/SkipLink.js';
import { NavItem } from '../components/atoms/NavItem.js';

export const MAIN_CONTENT_ID = 'main-content';

/**
 * `[I]` The four screens Phase 4 ships: Flags (D3/D4), Preview (D6), Audit
 * (D7). Flag detail is a sub-route of Flags, not a fourth top-level entry.
 * Their route elements land with their own slices; this batch (D2) owns only
 * the shell and the nav's own accessible names (row 49).
 */
const NAV_ITEMS = [
  { to: '/', label: 'Flags', end: true },
  { to: '/preview', label: 'Preview', end: false },
  { to: '/audit', label: 'Audit', end: false },
] as const;

export interface ShellProps {
  readonly children: ReactNode;
}

/**
 * The one layout every authenticated screen renders inside (D2). Order is
 * load-bearing for keyboard navigation (row 49): the skip link is the FIRST
 * focusable element in the document — before the nav — so a keyboard user
 * never has to tab through every nav item to reach the screen content.
 */
export function Shell({ children }: ShellProps): ReactElement {
  return (
    <>
      <SkipLink targetId={MAIN_CONTENT_ID} />
      <nav aria-label="Primary">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavItem to={item.to} label={item.label} end={item.end} />
            </li>
          ))}
        </ul>
      </nav>
      {/* tabIndex={-1}: not in the normal Tab order, but focusable
          programmatically — exactly what SkipLink's onClick targets. */}
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
