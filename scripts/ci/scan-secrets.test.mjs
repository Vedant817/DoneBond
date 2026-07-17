import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run, scanText } from "../scan-secrets.mjs";

test("detects credentials without returning their values", () => {
  const credential = ["ghp", "A".repeat(36)].join("_");
  const findings = scanText(`const token = "${credential}";`, "fixture.js");

  assert.equal(
    findings.some((finding) => finding.rule === "GitHub token"),
    true
  );
  assert.equal(JSON.stringify(findings).includes(credential), false);
});

test("allows documented placeholders and environment references", () => {
  const contents = [
    'token = "your_token_here"',
    'password = "changeme"',
    'client_secret = "${CLIENT_SECRET}"',
    'api_key = "process.env.API_KEY"'
  ].join("\n");

  assert.deepEqual(scanText(contents, ".env.example"), []);
});

test("returns failure for a secret in an explicitly scanned file", () => {
  const root = mkdtempSync(join(tmpdir(), "donebond-secret-scan-"));
  const sensitiveValue = ["not-a-real", "credential", "but-sensitive"].join("-");
  writeFileSync(join(root, "unsafe.txt"), `password = "${sensitiveValue}"\n`);

  assert.equal(run(["--root", root, "--path", "unsafe.txt"]), 1);
});

test("skips binary files", () => {
  const root = mkdtempSync(join(tmpdir(), "donebond-secret-scan-"));
  writeFileSync(join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));

  assert.equal(run(["--root", root, "--path", "image.bin"]), 0);
});
