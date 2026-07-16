# Product Requirements Document

## Product

DoneBond — proof-of-done and outcome settlement for AI coding agents.

## Objective

Deliver a hosted, production-minded MVP that lets a developer define a verifiable coding task, independently generate evidence for an exact Git state, anchor a compact receipt on Monad, and optionally settle a native-MON bounty after approval.

## User personas

### Task owner

A founder, maintainer, or engineer who wants work completed against explicit acceptance criteria and does not want to trust an agent’s narrative alone.

### Contributor

A developer or AI coding agent performing the implementation and producing evidence.

### Public verifier

A reviewer, judge, customer, or maintainer who wants to confirm that a receipt matches the public evidence and onchain event.

## Jobs to be done

- When I delegate a coding task to an agent, help me know exactly what passed and what did not.
- When I approve work, bind that approval to a task, policy, evidence bundle, and Git commit.
- When I offer a bounty, ensure approval can credit payment without double release.
- When I review a receipt, let me independently verify hashes and transaction state.

## MVP functional requirements

### Authentication and identity

- Users can sign in through a simple secure method or connect a wallet.
- A user can associate a payout wallet with their account.
- Sensitive actions require current authorization and server-side ownership checks.

### Projects

- Create, list, view, and archive a project.
- Store repository URL, default branch, visibility, and verification policy.
- Generate a scoped CLI token that is displayed only once.

### Tasks

- Create a task with title, description, acceptance criteria, assignee wallet, deadline, and optional MON reward.
- Canonicalize the task payload and calculate `taskHash` and `policyHash`.
- Create the corresponding onchain task and persist its transaction/chain identifiers.
- Show lifecycle state: draft, awaiting-chain, open, receipt-submitted, approved, rejected, cancelled, expired.

### Verification policy

- A committed YAML policy defines allowed commands, working directories, timeouts, required status, output limits, and redaction patterns.
- Command execution uses argument arrays rather than a shell string.
- Unsafe constructs and paths outside the repository are rejected.
- Policy parsing and canonicalization are deterministic and versioned.

### Evidence generation

- Collect repository root, remote identity, branch, HEAD commit, tree hash, clean/dirty status, and a bounded diff summary.
- Execute each required check and record timestamps, duration, exit code, and bounded/redacted stdout/stderr.
- Capture environment metadata needed for reproducibility without exposing secrets.
- Mark the bundle passing only if every required deterministic check passes and repository constraints are met.
- Canonicalize the evidence object and calculate `evidenceHash`.
- Save a human-readable JSON file locally.

### Evidence upload and validation

- Authenticate CLI requests using a scoped, revocable token.
- Enforce size, schema, project, task, and replay constraints.
- Recompute canonical hashes on the server rather than trusting client fields.
- Store the bundle offchain and expose a stable receipt URL.
- Return a payload suitable for the user’s wallet transaction.

### Onchain registry and settlement

- Create a task commitment with optional native MON funding.
- Submit a receipt commitment containing the evidence and commit hashes.
- Allow only the task creator to approve/reject/cancel under valid state transitions.
- Approval credits the contributor’s withdrawable balance.
- Contributor withdraws via a reentrancy-safe pull payment.
- Emit complete events for indexing and recovery.

### Web application

- Dashboard for projects and tasks.
- Task creation and funding flow.
- Task detail with acceptance criteria, policy digest, receipt, check results, Git identity, and transaction links.
- Approval/rejection and withdrawal controls.
- Public proof page with no login requirement.
- Empty, loading, success, error, rejected-wallet, and failed-transaction states.

### Recovery and reconciliation

- Persist pending transaction intent before prompting the wallet.
- Reconcile submitted transactions on refresh or through a worker.
- Treat RPC errors and timeouts as unknown, not automatically failed.
- Make API writes idempotent.

## Non-functional requirements

### Security

- No arbitrary hosted command execution in MVP.
- No raw secrets or unredacted environment values in bundles.
- No private keys in the application database.
- Strict server-side authorization and input validation.
- Smart-contract invariants tested with fuzz and invariant tests.

### Reliability

- Core operations are idempotent.
- State can be reconstructed from database records plus contract events.
- Failed or pending transactions do not create contradictory UI state.

### Performance

- Normal pages should load quickly on a mid-range mobile connection.
- CLI output must stream enough progress for long checks while bounding stored output.
- Public proof page should be cacheable where safe.

### Accessibility

- Keyboard-operable core flows.
- Clear focus states and labels.
- Status is not represented by color alone.
- Responsive at mobile and desktop widths.

### Observability

- Structured request logs with correlation IDs.
- No credentials, raw tokens, or evidence output in production logs.
- Metrics for API errors, evidence validation failures, transaction reconciliation, and contract event lag.

## Acceptance scenarios

### Scenario A: failed evidence

Given a task whose policy requires tests, when a test exits non-zero, the CLI produces a non-passing bundle, the UI clearly shows the failed check, and the contract submission action is unavailable.

### Scenario B: passing receipt

Given a clean repository and all required checks passing, when the CLI uploads the bundle, the backend recomputes identical hashes and the user can submit the receipt commitment on Monad.

### Scenario C: funded approval

Given a funded open task and valid receipt, when the creator approves it, the task cannot be approved again and the contributor’s withdrawable balance increases exactly once.

### Scenario D: withdrawal

Given a positive withdrawable balance, when the contributor withdraws, the balance is zeroed before value transfer and cannot be withdrawn twice.

### Scenario E: independent verification

Given a public receipt URL, a reviewer can see the task/policy/evidence/commit commitments, re-hash a downloadable public bundle, and follow the transaction to a Monad explorer.

## Success criteria for submission

- Public repository with a credible commit history.
- Hosted web application.
- Verified contract on Monad Testnet or Mainnet.
- One complete live scenario with no mocked success state.
- Contract and application tests passing from a clean clone.
- Demo video under three minutes.
- Documentation sufficient for a judge to understand and reproduce the flow.
