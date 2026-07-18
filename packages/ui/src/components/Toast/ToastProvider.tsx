import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { Toast, type ToastItem } from "./Toast";
import { ToastContext, type ShowToastOptions } from "./ToastContext";
import styles from "./Toast.module.css";

const DEFAULT_DURATION_MS = 5000;

let fallbackId = 0;
function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `toast-${fallbackId}`;
}

export interface ToastProviderProps {
  children?: ReactNode;
}

/**
 * Owns the live toast stack and renders the notification region. Wrap the
 * app (or a screen) in this once, then call `useToast().showToast(...)`
 * anywhere beneath it.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options: ShowToastOptions = {}) => {
      const id = generateId();
      const tone = options.tone ?? "neutral";
      const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
      setToasts((current) => [...current, { id, message, tone }]);
      if (durationMs > 0) {
        const timer = setTimeout(() => dismiss(id), durationMs);
        timers.current.set(id, timer);
      }
    },
    [dismiss]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
