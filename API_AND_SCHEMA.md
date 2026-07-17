# API and Data Schema

## API conventions

- Prefix MVP routes with `/api/v1`.
- Validate every body, query, and path parameter with shared schemas.
- Return stable machine-readable error codes.
- Require an `Idempotency-Key` for task creation, evidence upload, and transaction registration.
- Use cursor pagination for lists.
- Never expose internal database IDs where a public opaque ID is available.

## Authentication modes

### Browser

Use a secure session with HTTP-only, secure, same-site cookies. State-changing browser requests require CSRF protection where relevant.

Wallet authentication routes:

```text
POST /api/v1/auth/challenge
POST /api/v1/auth/verify
GET  /api/v1/auth/session
POST /api/v1/auth/logout
```

Challenge and verification requests require the exact configured application
`Origin`. Verification sets an opaque HTTP-only session cookie and returns a
separate CSRF token for the browser to retain in memory. Logout requires that
token in `X-CSRF-Token`. Only keyed token/CSRF digests and a one-time nonce digest
are persisted; invalid CSRF attempts do not renew idle session lifetime.

### CLI

Use a randomly generated project-scoped token. Store only a strong hash of the token server-side. The token is displayed once, can be revoked, has a last-used timestamp, and cannot manage billing or organization settings.

## Core endpoints

### Projects

```text
POST   /api/v1/projects
GET    /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
POST   /api/v1/projects/:projectId/cli-tokens
DELETE /api/v1/projects/:projectId/cli-tokens/:tokenId
```

### Tasks

```text
POST /api/v1/projects/:projectId/tasks
GET  /api/v1/projects/:projectId/tasks
GET  /api/v1/tasks/:taskId
POST /api/v1/tasks/:taskId/chain-intent
POST /api/v1/tasks/:taskId/chain-transactions
```

Task creation response includes canonical payloads and commitments, but the server does not sign the user’s transaction.

### Evidence

```text
POST /api/v1/tasks/:taskId/evidence
GET  /api/v1/tasks/:taskId/evidence/:evidenceId
GET  /api/v1/public/receipts/:publicId
GET  /api/v1/public/receipts/:publicId/bundle
```

Evidence upload checks:

- token belongs to project;
- task belongs to project;
- schema version is supported;
- total size and each output field are bounded;
- task, policy, Git, and evidence hashes recompute correctly;
- no duplicate idempotency key with conflicting content;
- redaction markers and prohibited patterns pass server policy;
- passing claim matches required check outcomes.

### Chain reconciliation

```text
POST /api/v1/chain/reconcile/:transactionId
GET  /api/v1/chain/transactions/:transactionId
```

Workers or scheduled jobs can reconcile pending transactions using transaction hash and contract events.

## Suggested relational schema

### users

- `id`
- `display_name`
- `email` nullable
- `created_at`, `updated_at`

### wallets

- `id`, `user_id`
- `chain_id`
- `address_normalized`
- `verified_at`
- unique `(chain_id, address_normalized)`

### projects

- `id`, `owner_user_id`
- `slug`, `name`, `repository_url`, `default_branch`
- `visibility`
- `active_policy_id`
- timestamps

### policies

- `id`, `project_id`
- `schema_version`
- `canonical_json`
- `policy_hash`
- `source_path`
- timestamps

### tasks

- `id`, `project_id`
- `public_id`
- `chain_id`, `contract_address`, `chain_task_id`
- `title`, `description`, `acceptance_criteria_json`
- `task_hash`, `policy_hash`
- `creator_wallet`, `assignee_wallet`
- `reward_wei`, `deadline`
- `offchain_status`, `chain_status`
- timestamps

### evidence_bundles

- `id`, `task_id`, `public_id`
- `schema_version`
- `object_location`
- `evidence_hash`, `commit_hash_derived`, `git_object_id`
- `passing`
- `bundle_size_bytes`
- `submitted_by_token_id`
- timestamps

### verification_checks

- `id`, `evidence_bundle_id`
- `check_key`, `required`
- `started_at`, `duration_ms`, `exit_code`
- `stdout_digest`, `stderr_digest`
- `stdout_preview`, `stderr_preview`
- `status`

### chain_transactions

- `id`, `user_id`, `task_id`
- `intent_type`, `idempotency_key`
- `chain_id`, `from_address`, `to_address`
- `transaction_hash`, `nonce`
- `status`, `block_number`, `failure_code`
- timestamps

### contract_events

- `id`
- `chain_id`, `contract_address`
- `transaction_hash`, `log_index`
- `event_name`, `decoded_json`, `block_number`
- unique `(chain_id, transaction_hash, log_index)`

### audit_events

- `id`, `actor_user_id`, `project_id`, `task_id`
- `action`, `metadata_safe_json`, `created_at`

## Status consistency

Do not mutate an offchain task directly to “approved” because the browser reports success. Approval is confirmed only after receipt/event reconciliation. The UI may show a separate pending action state.

## Public API allowlist

A public proof may expose:

- task title and public acceptance criteria;
- project/repository URL if project is public;
- policy digest and safe policy summary;
- check names, status, duration, exit code, and redacted previews;
- original Git object ID and derived commitment;
- evidence hash;
- contract, chain, transaction, and block references;
- timestamps and lifecycle state.

Never expose:

- CLI token information;
- raw environment variables;
- absolute local filesystem paths;
- private repository URLs;
- unredacted output;
- IP address or internal observability metadata.
