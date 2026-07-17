import canonicalizePackage from "canonicalize";
import { keccak256, toBytes, type Hex } from "viem";

import { EvidenceError } from "./errors.js";

type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function assertCanonicalInput(value: unknown, path = "$"): asserts value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new EvidenceError(
        "BUNDLE_INVALID",
        `Canonical JSON number at ${path} must be a finite safe integer`
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCanonicalInput(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new EvidenceError("BUNDLE_INVALID", `Non-plain object at ${path}`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        throw new EvidenceError("BUNDLE_INVALID", `Undefined value at ${path}.${key}`);
      }
      assertCanonicalInput(entry, `${path}.${key}`);
    }
    return;
  }
  throw new EvidenceError("BUNDLE_INVALID", `Unsupported canonical JSON value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  assertCanonicalInput(value);
  const serialize = canonicalizePackage as unknown as (input: unknown) => string | undefined;
  const result = serialize(value);
  if (result === undefined) {
    throw new EvidenceError("BUNDLE_INVALID", "Value cannot be represented as canonical JSON");
  }
  return result;
}

export function canonicalKeccak256(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}

export function deriveCommitHash(objectId: string): Hex {
  return keccak256(toBytes(`donebond.git-commit:v1:${objectId.toLowerCase()}`));
}
