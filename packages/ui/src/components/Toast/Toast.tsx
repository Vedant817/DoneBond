import type { StatusIcon as StatusIconName } from "../../lib/status-treatment";
import type { StatusTone } from "../../lib/status-treatment";
import { StatusIcon } from "../icons/StatusIcon";
import styles from "./Toast.module.css";

export type ToastTone = StatusTone;

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

export interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

const TONE_CLASS: Record<ToastTone, string | undefined> = {
  success: styles.toneSuccess,
  pending: styles.tonePending,
  warning: styles.toneWarning,
  error: styles.toneError,
  critical: styles.toneCritical,
  neutral: styles.toneNeutral
};

const TONE_ICON: Record<ToastTone, StatusIconName> = {
  success: "check",
  pending: "clock",
  warning: "alert-triangle",
  error: "cross",
  critical: "alert-triangle",
  neutral: "document"
};

/**
 * A single toast notification. `role="status"` + `aria-live="polite"` (or
 * "assertive" for error/critical tones) makes assistive tech announce it
 * without stealing focus -- toasts never require keyboard interaction to be
 * perceived, but the dismiss button is still a real, focusable button.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  const urgent = toast.tone === "error" || toast.tone === "critical";
  return (
    <div
      className={styles.toast}
      role="status"
      aria-live={urgent ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <StatusIcon
        name={TONE_ICON[toast.tone]}
        className={`${styles.icon} ${TONE_CLASS[toast.tone]}`}
      />
      <span className={styles.message}>{toast.message}</span>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        Dismiss
      </button>
    </div>
  );
}
