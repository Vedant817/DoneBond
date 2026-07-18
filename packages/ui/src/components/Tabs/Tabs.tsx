import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { computeNextTabIndex, type TabsOrientation } from "../../lib/tabs-navigation";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  /** Accessible name for the tablist, e.g. "Task sections". */
  label: string;
  items: TabItem[];
  orientation?: TabsOrientation;
  /** Controlled selected tab id. Omit to let Tabs manage its own state. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
}

/**
 * Tabs primitive implementing the WAI-ARIA APG "tabs" pattern with a roving
 * tabindex: only the selected tab is in the Tab sequence; ArrowLeft/Right
 * (or ArrowUp/Down when vertical) move selection between tabs, Home/End jump
 * to the first/last tab, and each panel is a separate, labeled region.
 */
export function Tabs({
  label,
  items,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange
}: TabsProps) {
  const baseId = useId();
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? items[0]?.id);
  const selectedId = value ?? uncontrolledValue;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(id: string) {
    if (value === undefined) {
      setUncontrolledValue(id);
    }
    onValueChange?.(id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = items.findIndex((item) => item.id === selectedId);
    const nextIndex = computeNextTabIndex(currentIndex, event.key, items.length, orientation);
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    const nextItem = items[nextIndex];
    if (!nextItem) {
      return;
    }
    select(nextItem.id);
    tabRefs.current[nextIndex]?.focus();
  }

  const activeItem = items.find((item) => item.id === selectedId) ?? items[0];

  return (
    <div
      className={[styles.root, orientation === "vertical" ? styles.verticalRoot : undefined]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        role="tablist"
        aria-label={label}
        aria-orientation={orientation}
        className={[styles.tablist, orientation === "vertical" ? styles.verticalTablist : undefined]
          .filter(Boolean)
          .join(" ")}
        onKeyDown={handleKeyDown}
      >
        {items.map((item, index) => {
          const selected = item.id === selectedId;
          const tabId = `${baseId}-tab-${item.id}`;
          const panelId = `${baseId}-panel-${item.id}`;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className={[styles.tab, selected ? styles.tabSelected : undefined]
                .filter(Boolean)
                .join(" ")}
              onClick={() => select(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {activeItem ? (
        <div
          key={activeItem.id}
          id={`${baseId}-panel-${activeItem.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          tabIndex={0}
          className={styles.panel}
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}
