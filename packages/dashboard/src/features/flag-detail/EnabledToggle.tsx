import type { ChangeEvent, ReactElement } from 'react';

export interface EnabledToggleProps {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/**
 * Presentational (D4a): a labelled switch, ignorant of mutations — the
 * container decides what happens on change. A real `<label htmlFor>`
 * association, never a placeholder standing in for one (row 49 precedent).
 */
export function EnabledToggle({ id, label, checked, onChange }: EnabledToggleProps): ReactElement {
  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(event.target.checked);
  };

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={handleChange} />
    </div>
  );
}
