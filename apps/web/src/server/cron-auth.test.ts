import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedCronRequest } from "./cron-auth.ts";

const SECRET = "x".repeat(32);

test("cron authorization accepts only the exact bearer secret", () => {
  assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET), false);
  assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(isAuthorizedCronRequest(null, SECRET), false);
});

test("cron authorization fails closed for missing or short configuration", () => {
  assert.equal(isAuthorizedCronRequest("Bearer anything", undefined), false);
  assert.equal(isAuthorizedCronRequest("Bearer too-short", "too-short"), false);
});
