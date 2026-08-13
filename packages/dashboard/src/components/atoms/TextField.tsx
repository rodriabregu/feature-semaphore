import type { InputHTMLAttributes, ReactElement } from 'react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly id: string;
  readonly label: string;
}

/**
 * Presentational (D4): a `<label>` explicitly associated via `htmlFor`/`id` —
 * never a placeholder standing in for a label. Every interactive control
 * MUST resolve a real accessible name (spec: Accessibility of interactive
 * controls; design rows 49, 57, 59 apply the same rule to later screens).
 */
export function TextField({ id, label, ...inputProps }: TextFieldProps): ReactElement {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...inputProps} />
    </div>
  );
}
