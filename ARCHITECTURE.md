# Architecture

## System context

```text
Task owner / contributor
        |
        +---- Web app (Next.js) ---- API / DB ---- Evidence object storage
        |             |                 |
        |             |                 +---- Reconciliation / event indexer
        |             |
        |             +---- Wallet / viem / wagmi ---- Monad RPC
        |
        +---- DoneBond CLI ---- local repository and deterministic checks
                                      |
                                      +---- evidence bundle upload

Monad contract stores only commitments, lifecycle state, and reward accounting.
```

## Monorepo layout

```text
apps/
  web/                 Next.js UI and route handlers
  cli/                 @donebond/cli
packages/
  contracts/           Foundry Solidity project
  db/                  Drizzle schema, migrations, repositories
  evidence/            policy parser, canonicalizer, runner, redaction, hashing
  shared/              cross-package types and constants
  ui/                  shared UI primitives
  config/              TypeScript, lint, formatting configuration
tests/
  e2e/                 Playwright end-to-end flows
fixtures/
  sample-repo/         deterministic demonstration repository
```

Keep business rules in packages rather than duplicating them in pages or route handlers.

## Main components

### Web application

Responsibilities:

- authentication and session handling;
- project/task CRUD;
- wallet transaction preparation and tracking;
- receipt and proof views;
- creator approval/rejection;
- contributor withdrawal;
- public documentation and onboarding.

The browser never receives database credentials, signing secrets, or privileged internal tokens.

### API

Responsibilities:

- authorization and ownership checks;
- canonical task and policy hashing;
- CLI token lifecycle;
- evidence schema validation, redaction assertions, and hash recomputation;
- idempotent persistence;
- construction of unsigned contract call parameters;
- transaction reconciliation;
- public proof response with an explicit safe field allowlist.

### CLI

Responsibilities:

- repository initialization;
- secure policy parsing;
- deterministic command execution;
- Git metadata collection;
- evidence canonicalization and hashing;
- authenticated upload;
- local receipt verification.

The CLI must never silently alter source code or perform the coding agent’s task. It verifies the result.

### Evidence package

Use one implementation for browser-independent/server/CLI logic where feasible:

- schema versioning;
- canonical JSON serialization;
- hash functions;
- policy validation;
- result aggregation;
- output truncation and redaction;
- domain-specific error codes.

### Smart contract

`DoneBondRegistry` is the neutral commitment and settlement layer. It should not understand test logs or execute code. It enforces ownership, lifecycle transitions, replay resistance, and reward accounting.

### Database

Suggested entities:

- `users`
- `wallets`
- `projects`
- `project_members`
- `cli_tokens`
- `policies`
- `tasks`
- `evidence_bundles`
- `verification_checks`
- `chain_transactions`
- `contract_events`
- `audit_events`

Use UUID/ULID application identifiers and store chain task IDs separately.

## Canonical hashing

Use a documented canonical JSON strategy with:

- UTF-8 encoding;
- lexicographically sorted object keys;
- explicit schema/version field;
- no insignificant whitespace;
- stable representation of arrays and numbers;
- lowercased normalized Ethereum addresses;
- ISO timestamps where timestamps are part of an offchain bundle;
- `keccak256` for commitments submitted to EVM contracts.

Never hash UI-rendered text or nondeterministic objects.

Commitments:

```text
taskHash     = keccak256(canonicalTask)
policyHash   = keccak256(canonicalPolicy)
evidenceHash = keccak256(canonicalEvidence)
commitHash   = bytes32 representation derived from the full Git SHA policy
```

Because Git SHA-1/SHA-256 values do not naturally equal an EVM `bytes32` in every repository mode, define a stable conversion such as `keccak256(utf8(fullGitObjectId))` and display both the original Git object ID and derived bytes32 value.

## Core sequence

### Create task

1. Browser sends task and policy reference to API.
2. API validates authorization and computes canonical commitments.
3. API creates a draft/pending transaction record with an idempotency key.
4. Browser asks wallet to call `createTask` and optionally sends MON.
5. API reconciles the receipt/event and marks the task open.

### Verify task

1. CLI loads policy from the repository.
2. CLI validates allowed commands and Git constraints.
3. CLI executes checks without a shell and records results.
4. CLI redacts/truncates output and builds canonical evidence.
5. CLI writes the evidence file and optionally uploads it.
6. API validates schema and recomputes commitments.

### Submit receipt

1. API returns validated receipt transaction parameters.
2. Contributor submits `submitReceipt` from the expected wallet.
3. Reconciliation records the emitted event and task state.
4. Public proof page becomes available.

### Approve and settle

1. Creator reviews evidence and submits `approveTask`.
2. Contract changes state and credits `withdrawable[contributor]`.
3. Contributor submits `withdraw`.
4. Contract zeroes credit before transferring MON and emits an event.

## Trust boundaries

- **Local repository:** untrusted until verification finishes.
- **Policy file:** project-controlled but strictly validated.
- **CLI:** trusted to collect evidence, but server recomputes all derivable fields.
- **Evidence upload:** untrusted input subject to schema, size, auth, replay, and redaction checks.
- **Browser:** untrusted client; never authoritative for ownership or lifecycle.
- **RPC:** may be delayed or unavailable; chain state is authoritative after confirmation.
- **Database:** operational index, not the final source of onchain truth.
- **Contract:** authoritative for commitments and funds, but not for offchain test correctness.

## Transaction state model

Do not represent chain work as a Boolean. Use:

```text
prepared -> wallet_requested -> submitted -> confirmed
                              -> rejected_by_user
                              -> replaced
                              -> reverted
                              -> unknown/reconcile
```

On timeout, keep the transaction recoverable and reconcile by hash, nonce, and emitted events.

## Parallel-agent architecture work

Agents may work in separate Git worktrees on non-overlapping packages:

- contract engineer: `packages/contracts/**`
- evidence engineer: `packages/evidence/**`
- CLI engineer: `apps/cli/**`
- backend engineer: `packages/db/**` and API service files
- frontend engineer: web pages/components after shared contracts stabilize
- QA engineer: `tests/**` and fixtures
- security reviewer: read-only findings first; patches on a dedicated branch

Shared schema/type changes require an explicit integration checkpoint before dependent agents continue.
