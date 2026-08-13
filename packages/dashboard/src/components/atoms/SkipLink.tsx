import type { MouseEvent, ReactElement } from 'react';

export interface SkipLinkProps {
  readonly targetId: string;
}

/**
 * Presentational (D4): the FIRST focusable element in the document (row 49).
 * Activating it moves focus straight to the main landmark rather than
 * relying on the browser's native hash-jump, which jsdom does not simulate —
 * `preventDefault` plus an explicit `.focus()` call keeps the behaviour
 * testable and identical across environments.
 */
export function SkipLink({ targetId }: SkipLinkProps): ReactElement {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    document.getElementById(targetId)?.focus();
  };

  return (
    <a href={`#${targetId}`} onClick={handleClick}>
      Skip to main content
    </a>
  );
}
