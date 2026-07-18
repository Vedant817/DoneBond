import { useId, type ReactNode } from "react";

import styles from "./Field.module.css";

export interface FieldIds {
  controlId: string;
  hintId: string | undefined;
  errorId: string | undefined;
  describedBy: string | undefined;
}

/** Computes the id wiring a labeled form control needs -- shared by Input and Textarea. */
export function useFieldIds(
  id: string | undefined,
  hint: string | undefined,
  error: string | undefined
): FieldIds {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return { controlId, hintId, errorId, describedBy };
}

export interface FieldProps {
  label: string;
  controlId: string;
  hint?: string | undefined;
  hintId?: string | undefined;
  error?: string | undefined;
  errorId?: string | undefined;
  children: ReactNode;
}

/** Layout wrapper: label + control + hint/error, shared by Input and Textarea. */
export function Field({ label, controlId, hint, hintId, error, errorId, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={controlId}>
        {label}
      </label>
      {children}
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
