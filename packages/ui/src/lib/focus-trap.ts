/**
 * Pure logic backing the Dialog primitive's focus trap.
 *
 * Kept free of DOM APIs so it can be unit-tested with plain node:test
 * (this repo has no jsdom/browser test runner). The Dialog component wires
 * this to the real DOM: it queries focusable elements into an ordered list,
 * tracks the index of the currently focused element within that list, and
 * calls `computeTrapFocusIndex` on every Tab keydown.
 */

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

/**
 * Given the index of the currently focused element within an ordered list of
 * `count` focusable elements (-1 if focus is currently outside the list),
 * returns the index that Tab / Shift+Tab should move focus to, wrapping at
 * either end so focus never escapes the dialog.
 *
 * Returns null when there is nothing focusable to trap focus within.
 */
export function computeTrapFocusIndex(
  currentIndex: number,
  count: number,
  shiftKey: boolean
): number | null {
  if (count <= 0) {
    return null;
  }

  if (currentIndex < 0) {
    return shiftKey ? count - 1 : 0;
  }

  if (shiftKey) {
    return currentIndex === 0 ? count - 1 : currentIndex - 1;
  }

  return currentIndex === count - 1 ? 0 : currentIndex + 1;
}

/** True when the given keydown key should close the dialog (WAI-ARIA APG dialog pattern). */
export function isDialogCloseKey(key: string): boolean {
  return key === "Escape";
}

/** True when the given keydown key is the Tab key that the trap must intercept. */
export function isTabKey(key: string): boolean {
  return key === "Tab";
}
