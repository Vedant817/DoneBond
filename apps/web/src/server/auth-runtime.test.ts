import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import { register } from "../instrumentation.ts";
import { dispatchAuthRequest } from "./auth-runtime.ts";

test("Node startup fails fast while requests retain a stable error envelope", async () => {
  const previousRuntime = process.env.NEXT_RUNTIME;
  const previousOrigin = process.env.NEXT_PUBLIC_APP_URL;
  const previousSecret = process.env.AUTH_SECRET;
  try {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.AUTH_SECRET;
    await assert.rejects(register(), /NEXT_PUBLIC_APP_URL and AUTH_SECRET are required/u);

    const response = await dispatchAuthRequest(
      "session",
      new Request("https://donebond.test/api/v1/auth/session")
    );
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, ERROR_CODES.INTERNAL_ERROR);
    assert.equal(JSON.stringify(body).includes("AUTH_SECRET"), false);
  } finally {
    if (previousRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = previousRuntime;
    if (previousOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousOrigin;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});
