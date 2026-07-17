import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeEthereumAddress,
  normalizeGitObjectId,
  normalizePublicIdentifier
} from "../dist/index.js";

test("normalizes Ethereum addresses and Git object IDs to lowercase", () => {
  assert.equal(
    normalizeEthereumAddress(" 0xAABBCCDDEEFF0011223344556677889900AABBCC "),
    "0xaabbccddeeff0011223344556677889900aabbcc"
  );
  assert.equal(normalizeGitObjectId("A".repeat(40)), "a".repeat(40));
});

test("normalizes safe public identifiers", () => {
  assert.equal(normalizePublicIdentifier("project_one-2"), "project_one-2");
});

test("rejects malformed addresses and ambiguous identifiers", () => {
  assert.throws(() => normalizeEthereumAddress("0x1234"));
  assert.throws(() => normalizeEthereumAddress("0x52908400098527886e0F7030069857D2E4169EE7"));
  assert.throws(() => normalizePublicIdentifier(" Project_One "));
  assert.throws(() => normalizePublicIdentifier("project one"));
  assert.throws(() => normalizePublicIdentifier("../project"));
  assert.throws(() => normalizeGitObjectId("a".repeat(41)));
});
