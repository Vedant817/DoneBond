import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from "react";

import {
  computeTrapFocusIndex,
  FOCUSABLE_SELECTOR,
  isDialogCloseKey,
  isTabKey
} from "../../lib/focus-trap";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
}

/**
 * Modal dialog implementing the WAI-ARIA APG "dialog (modal)" pattern:
 * role="dialog" + aria-modal, a focus trap that cycles Tab/Shift+Tab within
 * the panel, Escape to close, and focus restored to the element that
 * triggered the dialog when it closes.
 */
export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    triggerRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusable = panel
      ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];
    (focusable[0] ?? panel)?.focus();

    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isDialogCloseKey(event.key)) {
      event.stopPropagation();
      onClose();
      return;
    }

    if (isTabKey(event.key)) {
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = computeTrapFocusIndex(currentIndex, focusable.length, event.shiftKey);
      if (nextIndex !== null) {
        event.preventDefault();
        focusable[nextIndex]?.focus();
      }
    }
  }

  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        ) : null}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
