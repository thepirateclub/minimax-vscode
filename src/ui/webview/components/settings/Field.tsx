import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

// The field of the settings: a name, the control and the hint under it.
// The markup of eleven fields was the same, the component keeps them alike.
export function Field({ label, hint, children }: FieldProps): ReactNode {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}
