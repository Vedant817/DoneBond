import assert from "node:assert/strict";
import test from "node:test";

import { reportDependencyFailure } from "./health-observability.ts";

test("health diagnostics retain safe codes without logging sensitive error details", () => {
  const original = console.error;
  const messages: string[] = [];
  console.error = (message?: unknown) => messages.push(String(message));
  try {
    reportDependencyFailure(
      "database",
      new Error("query and password must stay private", {
        cause: Object.assign(new Error("private TLS detail"), {
          code: "SELF_SIGNED_CERT_IN_CHAIN"
        })
      })
    );
  } finally {
    console.error = original;
  }

  assert.deepEqual(JSON.parse(messages[0] ?? "{}"), {
    level: "error",
    event: "health_dependency_failed",
    dependency: "database",
    code: "SELF_SIGNED_CERT_IN_CHAIN"
  });
  assert.doesNotMatch(messages[0] ?? "", /password|query|private/i);
});

test("health diagnostics collapse unknown errors to a non-sensitive code", () => {
  const original = console.error;
  const messages: string[] = [];
  console.error = (message?: unknown) => messages.push(String(message));
  try {
    reportDependencyFailure("rpc", new Error("secret upstream response"));
  } finally {
    console.error = original;
  }

  assert.match(messages[0] ?? "", /DEPENDENCY_ERROR/);
  assert.doesNotMatch(messages[0] ?? "", /secret upstream response/);
});
