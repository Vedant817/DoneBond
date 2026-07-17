import assert from "node:assert/strict";
import test from "node:test";

import { DoneBondRepository, databaseSchema, parseDatabaseEnvironment } from "@donebond/db";

test("package self-reference loads the built JavaScript runtime", () => {
  assert.equal(typeof DoneBondRepository, "function");
  assert.equal(typeof parseDatabaseEnvironment, "function");
  assert.equal(typeof databaseSchema.tasks, "object");
});
