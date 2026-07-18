"use client";

// This package is consumed as a single client boundary: several primitives
// (Dialog, Tabs, Toast, HashDisplay, Input, Textarea) are inherently
// interactive and need hooks/event handlers, so the whole barrel is marked
// "use client" here rather than scattering the directive file-by-file.
// Server Components may still import and render any of these exports --
// only the reverse (a Client Component importing Server-only code) is
// disallowed by React Server Components.

// Typography & layout primitives
export { Text } from "./components/Text/Text";
export type { TextProps, TextSize, TextTone } from "./components/Text/Text";

export { Heading } from "./components/Heading/Heading";
export type { HeadingLevel, HeadingProps } from "./components/Heading/Heading";

export { Stack } from "./components/Stack/Stack";
export type { StackAlign, StackDirection, StackGap, StackProps } from "./components/Stack/Stack";

export { InlineCode, CodeBlock } from "./components/Code/Code";
export type { CodeBlockProps, InlineCodeProps } from "./components/Code/Code";

// Form primitives
export { Button } from "./components/Button/Button";
export type { ButtonProps, ButtonVariant } from "./components/Button/Button";

export { Input } from "./components/Input/Input";
export type { InputProps } from "./components/Input/Input";

export { Textarea } from "./components/Textarea/Textarea";
export type { TextareaProps } from "./components/Textarea/Textarea";

// Overlay primitives
export { Dialog } from "./components/Dialog/Dialog";
export type { DialogProps } from "./components/Dialog/Dialog";

export { Toast } from "./components/Toast/Toast";
export type { ToastItem, ToastProps, ToastTone } from "./components/Toast/Toast";
export { ToastProvider } from "./components/Toast/ToastProvider";
export type { ToastProviderProps } from "./components/Toast/ToastProvider";
export { useToast } from "./components/Toast/useToast";
export type { ShowToastOptions, ToastContextValue } from "./components/Toast/ToastContext";

// Navigation primitives
export { Tabs } from "./components/Tabs/Tabs";
export type { TabItem, TabsProps } from "./components/Tabs/Tabs";

// Status primitives
export { StatusBadge } from "./components/StatusBadge/StatusBadge";
export type { StatusBadgeProps } from "./components/StatusBadge/StatusBadge";

export { HashDisplay } from "./components/HashDisplay/HashDisplay";
export type { HashDisplayProps } from "./components/HashDisplay/HashDisplay";

export { CheckResult } from "./components/CheckResult/CheckResult";
export type { CheckResultProps } from "./components/CheckResult/CheckResult";

export { TransactionState } from "./components/TransactionState/TransactionState";
export type { TransactionStateProps } from "./components/TransactionState/TransactionState";

// Design-token-adjacent logic, exposed for consumers that need the raw
// status vocabulary without a rendered component (e.g. sorting by tone).
export { chainTransactionStatusTreatment, checkStatusTreatment } from "./lib/status-treatment";
export type {
  ChainTransactionStatus,
  CheckStatus,
  StatusIcon,
  StatusTone,
  StatusTreatment
} from "./lib/status-treatment";
export { truncateHash, looksLikeHexHash } from "./lib/hash";
export type { TruncateHashOptions } from "./lib/hash";
