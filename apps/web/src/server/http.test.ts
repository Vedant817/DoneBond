import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_CODES } from "@donebond/shared";

import {
  HttpError,
  correlationId,
  errorResponse,
  readBoundedJson,
  requireTrustedOrigin
} from "./http.ts";

test("bounded JSON accepts structured syntax and rejects content type, malformed, and oversized bodies", async () => {
  const valid = new Request("https://donebond.test/api", {
    method: "POST",
    headers: { "content-type": "application/problem+json" },
    body: JSON.stringify({ ok: true })
  });
  assert.deepEqual(await readBoundedJson(valid, 100), { ok: true });

  await assert.rejects(
    readBoundedJson(
      new Request("https://donebond.test/api", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}"
      }),
      100
    ),
    { code: ERROR_CODES.INVALID_CONTENT_TYPE, status: 415 }
  );
  await assert.rejects(
    readBoundedJson(
      new Request("https://donebond.test/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json"
      }),
      100
    ),
    { code: ERROR_CODES.VALIDATION_INVALID_INPUT, status: 400 }
  );
  await assert.rejects(
    readBoundedJson(
      new Request("https://donebond.test/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(200) })
      }),
      100
    ),
    { code: ERROR_CODES.PAYLOAD_TOO_LARGE, status: 413 }
  );
  const malformedUtf8 = new Uint8Array([
    ...Buffer.from('{"value":"', "utf8"),
    0xc3,
    0x28,
    ...Buffer.from('"}', "utf8")
  ]);
  await assert.rejects(
    readBoundedJson(
      new Request("https://donebond.test/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: malformedUtf8
      }),
      100
    ),
    { code: ERROR_CODES.VALIDATION_INVALID_INPUT, status: 400 }
  );
});

test("trusted-origin enforcement is exact and fail closed", () => {
  const accepted = new Request("https://donebond.test/api", {
    headers: { origin: "https://donebond.test" }
  });
  assert.doesNotThrow(() => requireTrustedOrigin(accepted, "https://donebond.test"));
  assert.doesNotThrow(() => requireTrustedOrigin(accepted, "https://DONEBOND.TEST/"));
  assert.throws(() => requireTrustedOrigin(accepted, "https://donebond.test/path"), {
    code: ERROR_CODES.AUTH_CSRF_INVALID,
    status: 403
  });
  for (const origin of [
    null,
    "https://evil.test",
    "not-a-url",
    "https://donebond.test/path?query=1"
  ]) {
    const request =
      origin === null
        ? new Request("https://donebond.test/api")
        : new Request("https://donebond.test/api", { headers: { origin } });
    assert.throws(() => requireTrustedOrigin(request, "https://donebond.test"), {
      code: ERROR_CODES.AUTH_CSRF_INVALID,
      status: 403
    });
  }
});

test("correlation IDs are bounded and error responses never expose unknown exception details", async () => {
  const supplied = "request_12345678";
  assert.equal(
    correlationId(
      new Request("https://donebond.test", { headers: { "x-correlation-id": supplied } })
    ),
    supplied
  );
  const generated = correlationId(
    new Request("https://donebond.test", { headers: { "x-correlation-id": "bad value\n" } })
  );
  assert.notEqual(generated, "bad value");

  const response = errorResponse(new Error("database password should remain private"), generated);
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.equal(body.includes("password"), false);
  assert.match(body, /INTERNAL_ERROR/u);

  const known = errorResponse(
    new HttpError(ERROR_CODES.AUTH_REQUIRED, "Sign in is required", 401),
    supplied
  );
  assert.equal(known.status, 401);
});
