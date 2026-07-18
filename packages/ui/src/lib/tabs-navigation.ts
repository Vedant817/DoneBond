/**
 * Pure keyboard-navigation logic for the Tabs primitive, following the
 * WAI-ARIA Authoring Practices Guide "tabs" pattern (roving tabindex):
 * ArrowRight/ArrowLeft (or ArrowDown/ArrowUp for vertical tab lists) move to
 * the adjacent tab and wrap at the ends; Home/End jump to the first/last tab.
 */

export type TabsOrientation = "horizontal" | "vertical";

/**
 * Returns the index the tablist should move focus/selection to for a given
 * keydown `key`, or null if the key is not one this pattern handles (the
 * caller should let the event pass through unmodified).
 */
export function computeNextTabIndex(
  currentIndex: number,
  key: string,
  count: number,
  orientation: TabsOrientation = "horizontal"
): number | null {
  if (count <= 0) {
    return null;
  }

  const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const previousKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";

  if (key === nextKey) {
    return (currentIndex + 1 + count) % count;
  }

  if (key === previousKey) {
    return (currentIndex - 1 + count) % count;
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return count - 1;
  }

  return null;
}
