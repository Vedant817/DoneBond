import assert from "node:assert/strict";
import { test } from "node:test";

import { computeTrapFocusIndex, isDialogCloseKey, isTabKey } from "./focus-trap.ts";

test("computeTrapFocusIndex returns null when nothing is focusable", () => {
  assert.equal(computeTrapFocusIndex(0, 0, false), null);
  assert.equal(computeTrapFocusIndex(-1, 0, true), null);
});

test("computeTrapFocusIndex advances forward and wraps to the first element", () => {
  assert.equal(computeTrapFocusIndex(0, 3, false), 1);
  assert.equal(computeTrapFocusIndex(1, 3, false), 2);
  assert.equal(computeTrapFocusIndex(2, 3, false), 0, "wraps last -> first");
});

test("computeTrapFocusIndex moves backward on shift and wraps to the last element", () => {
  assert.equal(computeTrapFocusIndex(2, 3, true), 1);
  assert.equal(computeTrapFocusIndex(1, 3, true), 0);
  assert.equal(computeTrapFocusIndex(0, 3, true), 2, "wraps first -> last");
});

test("computeTrapFocusIndex recovers to a boundary element when focus left the list", () => {
  assert.equal(computeTrapFocusIndex(-1, 5, false), 0, "Tab from outside goes to first");
  assert.equal(computeTrapFocusIndex(-1, 5, true), 4, "Shift+Tab from outside goes to last");
});

test("computeTrapFocusIndex handles a single focusable element by holding focus in place", () => {
  assert.equal(computeTrapFocusIndex(0, 1, false), 0);
  assert.equal(computeTrapFocusIndex(0, 1, true), 0);
});

test("isDialogCloseKey only matches Escape", () => {
  assert.equal(isDialogCloseKey("Escape"), true);
  assert.equal(isDialogCloseKey("Enter"), false);
  assert.equal(isDialogCloseKey("Tab"), false);
});

test("isTabKey only matches Tab", () => {
  assert.equal(isTabKey("Tab"), true);
  assert.equal(isTabKey("Escape"), false);
});
