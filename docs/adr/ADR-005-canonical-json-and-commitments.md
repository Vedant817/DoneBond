# ADR-005: Canonical JSON and commitment encoding

## Status

Accepted

## Context

The CLI, API, public verifier, and contract integration must derive identical
commitments from the same semantic task, policy, and evidence. JavaScript object
insertion order, optional fields, unsafe integers, address casing, and Unicode
variants can otherwise produce incompatible hashes.

## Decision

DoneBond uses RFC 8785 JSON Canonicalization Scheme semantics over versioned,
strict runtime schemas. Canonical payloads contain no `undefined` values. A field
that participates in a commitment is either required or explicitly nullable;
omission and `null` are never treated as equivalent. Arrays preserve their input
order because acceptance criteria and policy checks are ordered commitments.

Before canonicalization:

- human-authored text is trimmed and normalized to Unicode NFC;
- EVM addresses, `bytes32`, and Git object IDs are lowercase;
- Git IDs are exactly 40 or 64 hexadecimal characters;
- wei, chain task IDs, block numbers, and other potentially large integers are
  base-10 strings without leading zeroes;
- generated database IDs, audit timestamps, and transaction state are excluded
  from task and policy commitments; the user-selected deadline is included as a
  canonical unsigned 64-bit Unix-seconds decimal string.

`CanonicalTaskV1` includes a `kind` value of `donebond.task`; policy uses
`donebond.policy`. These fields domain-separate payloads while retaining the
simple formula:

```text
taskHash     = keccak256(UTF8(JCS(CanonicalTaskV1)))
policyHash   = keccak256(UTF8(JCS(CanonicalPolicyV1)))
evidenceHash = keccak256(UTF8(JCS(EvidenceBundleV1)))
commitHash   = keccak256(UTF8("donebond.git-commit:v1:" + lowercaseGitObjectId))
```

The evidence package owns canonicalization and hashing. Shared owns only the
browser-safe runtime schemas. Frozen fixtures must be reproduced independently
by CLI and server code before checkpoint 2.

## Consequences

- Schema changes require a new version and new fixed vectors.
- JSON numbers are used only inside the interoperable safe-integer range.
- Semantically reordered arrays intentionally produce different commitments.
- Pretty-printed evidence is for humans; canonical bytes are authoritative.
