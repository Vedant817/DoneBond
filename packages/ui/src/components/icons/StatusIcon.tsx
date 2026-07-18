import type { StatusIcon as StatusIconName } from "../../lib/status-treatment";

export interface StatusIconProps {
  name: StatusIconName;
  className?: string | undefined;
}

/**
 * Small hand-drawn line icons for status treatments. Always rendered
 * alongside a visible text label (never as the sole indicator of state), and
 * always `aria-hidden` -- the label carries the accessible name.
 */
export function StatusIcon({ name, className }: StatusIconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {renderPath(name)}
    </svg>
  );
}

function renderPath(name: StatusIconName) {
  switch (name) {
    case "check":
      return <path d="M3 8.5 6.2 12 13 4" />;
    case "cross":
      return <path d="M4 4 12 12 M12 4 4 12" />;
    case "clock":
      return (
        <>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M8 4.75V8l2.5 1.5" />
        </>
      );
    case "alert-triangle":
      return (
        <>
          <path d="M8 2.5 14.5 13.5H1.5Z" />
          <path d="M8 6.5v3" />
          <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
        </>
      );
    case "minus":
      return <path d="M3.5 8h9" />;
    case "upload":
      return (
        <>
          <path d="M8 11V3.5 M5 6.5 8 3.5l3 3" />
          <path d="M3 12.5v.75c0 .55.45 1 1 1h8c.55 0 1-.45 1-1v-.75" />
        </>
      );
    case "refresh":
      return (
        <>
          <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6" />
          <path d="M13 3v3h-3" />
          <path d="M13 8a5 5 0 0 1-8.5 3.5L3 10" />
          <path d="M3 13v-3h3" />
        </>
      );
    case "question":
      return (
        <>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M6.2 6.3a1.9 1.9 0 1 1 2.9 1.6c-.6.4-1.1.8-1.1 1.5v.3" />
          <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
        </>
      );
    case "document":
      return (
        <>
          <path d="M4.5 2.5h4.5L11.5 5.5v8h-7Z" />
          <path d="M9 2.5v3h2.5" />
        </>
      );
    default: {
      const exhaustive: never = name;
      throw new Error(`Unhandled status icon: ${String(exhaustive)}`);
    }
  }
}
