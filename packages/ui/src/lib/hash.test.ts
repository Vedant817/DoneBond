import assert from "node:assert/strict";
import { test } from "node:test";

import { looksLikeHexHash, truncateHash } from "./hash.ts";

const FULL_HASH = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";

test("truncateHash shortens a long hash to head...tail with default widths", () => {
  const result = truncateHash(FULL_HASH);
  assert.equal(result, "0x1234…abcd");
});

test("truncateHash returns short values unchanged", () => {
  assert.equal(truncateHash("0xabc"), "0xabc");
});

test("truncateHash returns the value unchanged exactly at the no-op boundary", () => {
  // length === head + tail + ellipsis.length should not be truncated further
  const boundary = "0".repeat(6 + 4 + 1);
  assert.equal(truncateHash(boundary), boundary);
});

test("truncateHash truncates once one character past the boundary", () => {
  const overBoundary = "0".repeat(6 + 4 + 2);
  const result = truncateHash(overBoundary);
  assert.equal(result, `${overBoundary.slice(0, 6)}…${overBoundary.slice(-4)}`);
});

test("truncateHash respects custom head/tail/ellipsis", () => {
  const result = truncateHash(FULL_HASH, { head: 4, tail: 2, ellipsis: "..." });
  assert.equal(result, "0x12...cd");
});

test("truncateHash rejects negative widths", () => {
  assert.throws(() => truncateHash(FULL_HASH, { head: -1 }), RangeError);
});

test("looksLikeHexHash accepts well-formed 0x hex strings", () => {
  assert.equal(looksLikeHexHash(FULL_HASH), true);
  assert.equal(looksLikeHexHash("0xAB12"), true);
});

test("looksLikeHexHash rejects malformed values", () => {
  assert.equal(looksLikeHexHash("1234"), false, "missing 0x prefix");
  assert.equal(looksLikeHexHash("0x123"), false, "odd length");
  assert.equal(looksLikeHexHash("0xzz"), false, "non-hex characters");
  assert.equal(looksLikeHexHash(""), false, "empty string");
});
