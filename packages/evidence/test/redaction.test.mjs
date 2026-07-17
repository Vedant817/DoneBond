import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoResidualSecrets,
  createBoundedOutput,
  decodeAndRedact,
  findResidualSecrets,
  redactText
} from "../dist/index.js";

test("default redaction removes seeded secrets including a split-line token", () => {
  const fakeGitHubToken = `ghp_${"abcdefghijklmnopq"}\n${"rstuvwxyz1234567890"}`;
  const fakePrivateKey = `0x${"a".repeat(64)}`;
  const input = [
    `token=${fakeGitHubToken}`,
    `PRIVATE_KEY=${fakePrivateKey}`,
    "DATABASE_URL=postgres://user:password@db.example.test/app"
  ].join("\n");
  const result = redactText(input);
  assert.equal(result.text.includes("password"), false);
  assert.equal(result.text.includes("aaaaaaaaaaaaaaaa"), false);
  assert.match(result.text, /\[REDACTED:github_token\]/);
  assert.equal(result.counts.private_key, 1);
  assert.equal(result.counts.database_url, 1);
  assert.deepEqual(findResidualSecrets(result.text), []);
});

test("ordinary hashes and credential-free URLs are not false positives", () => {
  const hash = `0x${"b".repeat(64)}`;
  const input = `${hash}\npostgres://db.example.test/app\nthis is ordinary text`;
  assert.deepEqual(redactText(input), { text: input, counts: {} });
});

test("project patterns and malformed binary are redacted deterministically", () => {
  const bytes = Buffer.from([0x66, 0x6f, 0x80, 0x6f]);
  const first = decodeAndRedact(bytes, ["foo"]);
  const second = decodeAndRedact(bytes, ["foo"]);
  assert.deepEqual(first, second);
  assert.match(first.text, /\[REDACTED:binary\]/);
  assert.equal(first.counts.binary > 0, true);
});

test("bounded output records original bytes, a stable digest, and deterministic marker", () => {
  const input = Buffer.from("x".repeat(5000));
  const first = createBoundedOutput(input, 128);
  const second = createBoundedOutput(input, 128);
  assert.deepEqual(first, second);
  assert.equal(first.originalBytes, 5000);
  assert.equal(first.truncated, true);
  assert.ok(Buffer.byteLength(first.preview) <= 128);
  assert.match(first.preview, /TRUNCATED:original-bytes=5000/);
});

test("residual secret scan rejects unredacted high-confidence values", () => {
  const secret = `Bearer ${"abcdefghijklmnopqrstuvwxyz"}${"0123456789"}`;
  assert.throws(() => assertNoResidualSecrets(secret), { code: "RESIDUAL_SECRET" });
});
