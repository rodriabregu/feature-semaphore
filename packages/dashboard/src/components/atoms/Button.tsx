import type { ButtonHTMLAttributes, ReactElement } from 'react';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Presentational (D4): the one button element every screen composes.
 * Defaults `type="button"` — the browser default of `type="submit"` inside a
 * `<form>` is a classic accidental-submit bug; callers that DO want a submit
 * button pass `type="submit"` explicitly, which this spread allows to win.
 */
export function Button(props: ButtonProps): ReactElement {
  return <button type="button" {...props} />;
}
