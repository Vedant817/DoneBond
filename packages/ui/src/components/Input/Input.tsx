import type { InputHTMLAttributes } from "react";

import { Field, useFieldIds } from "../Field/Field";
import styles from "./Input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

/**
 * Labeled text input. The label is always a real associated <label> (not
 * just a placeholder), and hint/error text is wired via aria-describedby so
 * assistive tech announces it alongside the field.
 */
export function Input({ label, hint, error, id, className, ...rest }: InputProps) {
  const { controlId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);
  const classes = [styles.input, error ? styles.invalid : undefined, className]
    .filter(Boolean)
    .join(" ");

  return (
    <Field
      label={label}
      controlId={controlId}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <input
        id={controlId}
        className={classes}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </Field>
  );
}
