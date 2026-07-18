import type { HTMLAttributes } from "react";

import styles from "./Code.module.css";

export type InlineCodeProps = HTMLAttributes<HTMLElement>;

/** Inline code snippet, e.g. `donebond init` mentioned in body text. */
export function InlineCode({ className, ...rest }: InlineCodeProps) {
  const classes = [styles.inline, className].filter(Boolean).join(" ");
  return <code className={classes} {...rest} />;
}

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  children: string;
}

/**
 * Multi-line code block, e.g. copyable setup commands or a sample receipt.
 * Scrolls horizontally on narrow viewports instead of overflowing the page.
 */
export function CodeBlock({ className, children, ...rest }: CodeBlockProps) {
  const classes = [styles.block, className].filter(Boolean).join(" ");
  return (
    <pre className={classes} {...rest}>
      <code>{children}</code>
    </pre>
  );
}
