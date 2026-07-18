import { useEffect, useRef, useState, type HTMLAttributes } from "react";

import { truncateHash } from "../../lib/hash";
import styles from "./HashDisplay.module.css";

export interface HashDisplayProps extends HTMLAttributes<HTMLSpanElement> {
  /** The full 0x-prefixed hash value (task hash, evidence hash, tx hash, etc.). */
  value: string;
  /** What kind of hash this is, used only for the accessible name, e.g. "Evidence hash". */
  label?: string;
  /** Set false to always show the full value (e.g. in a code block that already scrolls). */
  truncate?: boolean;
}

const COPY_CONFIRMATION_MS = 2000;

/**
 * Displays a long hash truncated to "0x1234…abcd", with the full value
 * available three ways: a `title` tooltip, a keyboard-toggleable expand
 * (clicking/activating the value itself swaps truncated <-> full, so
 * keyboard users are never dependent on hover), and a one-click copy button
 * with a visible "Copied" confirmation state.
 */
export function HashDisplay({
  value,
  label,
  truncate = true,
  className,
  ...rest
}: HashDisplayProps) {
  const [expanded, setExpanded] = useState(!truncate);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  const displayValue = truncate && !expanded ? truncateHash(value) : value;
  const accessibleName = label ? `${label}: ${value}` : value;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be denied/unavailable (permissions, insecure
      // context, older browser). The copy button simply stays a no-op --
      // the value is still visible and selectable manually.
      return;
    }
    setCopied(true);
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }
    resetTimer.current = setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
  }

  return (
    <span className={[styles.root, className].filter(Boolean).join(" ")} {...rest}>
      <button
        type="button"
        className={styles.value}
        title={value}
        aria-label={accessibleName}
        aria-expanded={truncate ? expanded : undefined}
        onClick={() => setExpanded((current) => !current)}
      >
        {displayValue}
      </button>
      <button
        type="button"
        className={[styles.copyButton, copied ? styles.copied : undefined]
          .filter(Boolean)
          .join(" ")}
        onClick={handleCopy}
        aria-label={copied ? "Copied to clipboard" : `Copy ${label ?? "hash"} to clipboard`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
