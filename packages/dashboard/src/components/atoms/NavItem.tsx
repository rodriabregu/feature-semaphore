import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';

export interface NavItemProps {
  readonly to: string;
  readonly label: string;
  /** `end` matching mirrors `NavLink`'s own prop — `/` must not stay "active" for every sub-route. */
  readonly end?: boolean;
}

/**
 * Presentational (D4): one primary-nav entry. `label` is always visible text
 * content, never an icon alone, so it resolves a real accessible name
 * without any extra `aria-label` (row 49).
 */
export function NavItem({ to, label, end }: NavItemProps): ReactElement {
  return (
    <NavLink to={to} end={end}>
      {label}
    </NavLink>
  );
}
