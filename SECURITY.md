# Security Plan

## Security objective

Prevent false evidence, credential leakage, unauthorized task transitions, unsafe command execution, and loss or double accounting of funds.

## Threat model

### Assets

- Task and policy integrity
- Evidence integrity
- CLI access tokens
- User sessions
- Wallet ownership mappings
- Native MON rewards
- Public reputation of receipts
- Private repository metadata and command output

### Adversaries

- Malicious contributor crafting a passing bundle
- Compromised or hallucinating coding agent
- Attacker with a leaked CLI token
- Web attacker attempting IDOR/CSRF/XSS
- Contract caller attempting unauthorized transitions or reentrancy
- Dependency or CI compromise
- Honest user encountering RPC inconsistency and retrying actions

## Local command execution

MVP verification runs on the user’s own machine, not on DoneBond servers.

Rules:

- Policy commands are stored as executable plus argument array.
- Never invoke through `sh -c`, `bash -c`, `eval`, or equivalent.
- Reject command substitution, pipes, redirects, and shell metacharacters in executable fields.
- Resolve working directories and require them to remain under repository root.
- Use explicit timeouts and terminate child process groups.
- Bound stdout/stderr in memory and on disk.
- Do not inherit environment variables indiscriminately; use an allowlist plus required runtime basics.
- Do not run as root.
- Display exactly which checks will execute before the first run.

## Evidence integrity

- Shared schema and canonicalization implementation.
- Server recomputes all hashes.
- Each check includes exit code and output digests.
- Passing is derived, not accepted from a client Boolean.
- Required checks cannot be absent or duplicated.
- Bundle contains policy hash and task hash.
- Bundle binds to HEAD and tree state.
- Dirty repositories are rejected by default or explicitly represented as non-passing.
- Evidence schema is versioned and old versions are deliberately migrated or rejected.

## Redaction

Apply redaction before persistence and hashing of the public/safe bundle.

- Default patterns for private keys, seed phrases, bearer tokens, common cloud keys, database URLs, and GitHub tokens.
- User-configurable additional regular expressions with validation.
- Replace values with stable markers such as `[REDACTED:type]`.
- Record redaction count by category, never original value.
- Reject evidence if prohibited high-confidence secret patterns remain.
- Never include full environment dumps.

## API security

- Server-side object ownership checks on every route.
- Project-scoped CLI tokens stored hashed.
- Rate limiting by token/account/IP where safe.
- Idempotency for write endpoints.
- Strict content type, body size, and decompression limits.
- CSRF protection for cookie-authenticated mutations.
- Output encoding and safe rendering of logs/code.
- Content Security Policy.
- Secure cookies and session rotation.
- Audit events for token creation/revocation, task lifecycle, evidence upload, and chain actions.

## Smart-contract security

- Checks-effects-interactions.
- Pull payments.
- `nonReentrant` withdrawal.
- Explicit status machine.
- No arbitrary external calls except native withdrawal to the caller.
- Checked reward narrowing/casting.
- No upgradeability or delegatecall.
- No owner ability to seize task funds.
- Fuzz and invariant tests for solvency and single-credit behavior.
- Separate deployer wallet with minimal funds.

## Frontend/wallet security

- Display chain ID, contract address, method, and amount before transaction.
- Refuse unsupported networks.
- Do not ask for seed phrases or private keys.
- Do not treat browser transaction submission as confirmation.
- Protect against approval UI confusion by showing task title/hash suffix and reward.

## Supply-chain security

- Lock dependency versions.
- Use package-manager lockfile.
- Run dependency audit and license checks.
- Pin GitHub Actions by commit where practical.
- Minimize third-party actions.
- Add secret scanning and static analysis.
- Review all AI-generated dependency additions before accepting them.

## Security release gate

Before submission:

- threat model reviewed;
- contract unit/fuzz/invariant tests pass;
- authorization tests pass;
- no high-confidence secrets in Git history;
- dependency audit has no unresolved critical issue;
- CSP and security headers verified;
- evidence redaction tested with seeded fake secrets;
- reentrancy and double-approval tests pass;
- deployer and app secrets are not present in repository or build logs.
