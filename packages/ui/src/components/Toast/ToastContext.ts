import { createContext } from "react";

import type { ToastTone } from "./Toast";

export interface ShowToastOptions {
  tone?: ToastTone;
  /** Auto-dismiss delay in ms. Pass 0 to require manual dismissal. */
  durationMs?: number;
}

export interface ToastContextValue {
  showToast: (message: string, options?: ShowToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
