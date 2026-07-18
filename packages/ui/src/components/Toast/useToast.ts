import { useContext } from "react";

import { ToastContext, type ToastContextValue } from "./ToastContext";

/** Consumes the nearest ToastProvider. Throws if rendered outside one. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
