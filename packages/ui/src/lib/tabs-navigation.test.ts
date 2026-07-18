import assert from "node:assert/strict";
import { test } from "node:test";

import { computeNextTabIndex } from "./tabs-navigation.ts";

test("computeNextTabIndex moves forward and wraps on ArrowRight (horizontal, default)", () => {
  assert.equal(computeNextTabIndex(0, "ArrowRight", 3), 1);
  assert.equal(computeNextTabIndex(2, "ArrowRight", 3), 0);
});

test("computeNextTabIndex moves backward and wraps on ArrowLeft (horizontal, default)", () => {
  assert.equal(computeNextTabIndex(1, "ArrowLeft", 3), 0);
  assert.equal(computeNextTabIndex(0, "ArrowLeft", 3), 2);
});

test("computeNextTabIndex uses ArrowDown/ArrowUp for vertical orientation", () => {
  assert.equal(computeNextTabIndex(0, "ArrowDown", 3, "vertical"), 1);
  assert.equal(computeNextTabIndex(0, "ArrowUp", 3, "vertical"), 2);
  // horizontal keys must not move a vertical tablist
  assert.equal(computeNextTabIndex(0, "ArrowRight", 3, "vertical"), null);
});

test("computeNextTabIndex jumps to bounds on Home/End", () => {
  assert.equal(computeNextTabIndex(1, "Home", 4), 0);
  assert.equal(computeNextTabIndex(1, "End", 4), 3);
});

test("computeNextTabIndex ignores unrelated keys", () => {
  assert.equal(computeNextTabIndex(0, "Enter", 3), null);
  assert.equal(computeNextTabIndex(0, " ", 3), null);
});

test("computeNextTabIndex returns null for an empty tablist", () => {
  assert.equal(computeNextTabIndex(0, "ArrowRight", 0), null);
});

test("computeNextTabIndex holds position for a single tab", () => {
  assert.equal(computeNextTabIndex(0, "ArrowRight", 1), 0);
  assert.equal(computeNextTabIndex(0, "ArrowLeft", 1), 0);
});
