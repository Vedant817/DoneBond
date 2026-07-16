# Verification Strategy

## Principle

A deterministic failing check cannot be overruled by an AI reviewer, a polished summary, or a manual “looks good” flag. AI review is advisory unless the policy explicitly records it as a non-gating check.

## Verification layers

### Layer 1: repository integrity

- Correct repository root
- Expected remote/branch constraints
- HEAD commit and tree captured
- Clean working tree by default
- No untracked source files omitted from proof
- Git submodule state captured if supported

### Layer 2: deterministic project checks

Examples:

- formatting
- linting
- type checking
- unit tests
- contract tests
- build
- integration/e2e tests
- dependency or secret scan

Checks are project-defined but policy-constrained.

### Layer 3: evidence validation

- schema validation
- command result completeness
- derived pass/fail calculation
- redaction
- canonicalization
- hash recomputation
- replay and idempotency controls

### Layer 4: contract verification

- correct chain and contract
- expected task commitments
- receipt event matches evidence/commit commitments
- lifecycle state matches database index
- reward accounting and withdrawal state are correct

### Layer 5: human acceptance

The creator reviews whether the checks adequately cover the acceptance criteria. Approval is an explicit action bound to the receipt.

## Standard quality gates

Run from repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm build
pnpm test:e2e
```

Add security checks:

```bash
pnpm audit --prod
pnpm secrets:scan
pnpm contracts:slither   # only if reproducible in the environment
```

A skipped required command is failure.

## Evidence determinism tests

- Same semantic object with different key insertion order yields same hash.
- Different check exit code changes evidence hash.
- Different task/policy/commit changes evidence hash.
- Redaction is deterministic.
- Truncation marker and original byte count are deterministic.
- Unsupported schema version is rejected.
- Duplicate check keys are rejected.

## CLI tests

- Safe command execution with arguments containing spaces
- Shell metacharacters are not interpreted
- Timeout kills the full child process group
- Output bounds are enforced
- Fake secrets are redacted
- Dirty repository behavior
- No Git repository behavior
- Upload retry with same idempotency key
- Revoked/invalid token
- Server hash disagreement

## API tests

- Authentication and authorization matrix
- IDOR attempts across projects
- conflicting idempotency requests
- oversized evidence
- malformed compression/content type
- replayed evidence
- public field allowlist
- pending/confirmed/reverted transaction reconciliation

## Contract tests

See `CONTRACT_SPEC.md`; all transition, authorization, accounting, fuzz, and invariant tests are release-blocking.

## End-to-end golden path

1. Start from a clean sample repository with a deliberately incomplete feature.
2. Create a task and policy.
3. Run verification and observe a real failed test.
4. Make the implementation change.
5. Commit with the required personal Git identity.
6. Run verification and produce a passing bundle.
7. Upload and compare client/server hashes.
8. Submit receipt on Monad.
9. Open public proof and explorer transaction.
10. Approve task.
11. Withdraw reward.
12. Confirm final state after page refresh and independent chain read.

## Failure-path demo tests

At least these must be tested, even if not all appear in the video:

- wallet rejection;
- transaction revert;
- RPC timeout followed by successful reconciliation;
- duplicate approve attempt;
- withdrawal receiver failure;
- invalid evidence hash;
- stale/incorrect commit;
- leaked fake token in test output and successful redaction.

## Independent verifier subagent

The verifier agent receives only:

- task and acceptance criteria;
- final diff/commit;
- policy and evidence bundle;
- test instructions.

It must not rely on the implementer’s summary. It attempts to falsify completion, reports exact evidence, and cannot edit code unless the primary agent assigns a separate remediation branch.
