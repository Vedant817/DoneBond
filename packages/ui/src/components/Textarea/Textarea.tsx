import type { TextareaHTMLAttributes } from "react";

import { Field, useFieldIds } from "../Field/Field";
import styles from "./Textarea.module.css";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

/** Labeled multi-line text input, e.g. an acceptance-criteria editor field. */
export function Textarea({ label, hint, error, id, className, ...rest }: TextareaProps) {
  const { controlId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);
  const classes = [styles.textarea, error ? styles.invalid : undefined, className]
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
      <textarea
        id={controlId}
        className={classes}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </Field>
  );
}
