import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contract package remains bound to the specified registry", async () => {
  const specification = await readFile(
    new URL("../../../CONTRACT_SPEC.md", import.meta.url),
    "utf8"
  );
  assert.match(specification, /^# Smart Contract Specification/m);
  assert.match(specification, /`DoneBondRegistry\.sol`/);
});
