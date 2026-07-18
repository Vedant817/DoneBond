const SAFE_DEPENDENCY_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "28P01",
  "3D000",
  "57P03"
]);

function errorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = "code" in current ? current.code : undefined;
    if (typeof code === "string" && SAFE_DEPENDENCY_CODES.has(code)) return code;
    current = current.cause;
  }
  return undefined;
}

export function reportDependencyFailure(
  dependency: "configuration" | "database" | "rpc",
  error?: unknown
): void {
  console.error(
    JSON.stringify({
      level: "error",
      event: "health_dependency_failed",
      dependency,
      code: error === undefined ? "UNHEALTHY_RESPONSE" : (errorCode(error) ?? "DEPENDENCY_ERROR")
    })
  );
}
