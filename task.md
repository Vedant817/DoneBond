# DoneBond Implementation Tracker

This file is the source of truth for implementation progress. Agents must update it after every verified task. Do not mark an item complete because code was written; mark it complete only when its stated verification passes and the evidence or command is recorded in the work log.

## Status legend

- `[ ]` not started
- `[-]` in progress
- `[x]` implemented and verified
- `[!]` blocked; add the blocker and owner

## Global definition of done

A task is complete only when:

1. Acceptance criteria are satisfied.
2. Relevant automated tests exist and pass.
3. Formatting, lint, and type checking pass for touched code.
4. Security/privacy implications were reviewed.
5. Documentation/configuration is updated.
6. No temporary hardcoding, fake result, suppressed error, or untracked TODO remains.
7. A verifier other than the implementer reviews high-risk work.
8. `task.md` work log records commands and results.
9. Changes are committed with `Vedant817 <vedantmahajan271@gmail.com>`.

---

# Milestone 0 — Repository safety and baseline

## 0.1 Create a fresh hackathon repository

- [!] Create a new empty repository owned by `Vedant817`. Local repository is fresh; GitHub repository creation is blocked because `Vedant817/donebond` does not exist and `github-personal` has no usable SSH key.
- [x] Do not copy an earlier project’s `.git` directory or commit history.
- [x] Set repository-local identity:

```bash
git config --local user.name "Vedant817"
git config --local user.email "vedantmahajan271@gmail.com"
```

- [x] Configure the personal SSH remote, preferably:

```bash
git remote add origin git@github-personal:Vedant817/donebond.git
```

- [x] Run `scripts/verify-git-identity.sh` successfully.
- [!] Verify authentication using `ssh -T git@github-personal`. Blocked: `Permission denied (publickey)` on 2026-07-17.
- [x] Confirm no work-account email appears in `git config --local --list` or the remote URL.

**Verification:** script exits 0; first commit author/committer matches personal identity; remote resolves to `Vedant817` through the personal alias.

## 0.2 Establish project records

- [x] Copy this build kit into the fresh repository.
- [x] Add license, code of conduct if desired, contribution guide, and issue templates.
- [x] Add `.gitignore`, `.editorconfig`, Node version file, and package manager declaration.
- [x] Add `DECISIONS.md` or use ADRs for architectural changes.
- [x] Record hackathon deadline and release checklist in the README.

**Verification:** clean clone contains every operating document and no secrets.

---

# Milestone 1 — Workspace and continuous quality

## 1.1 Bootstrap monorepo

- [x] Initialize pnpm workspace and Turborepo.
- [x] Create `apps/web`, `apps/cli`, `packages/contracts`, `packages/db`, `packages/evidence`, `packages/shared`, `packages/ui`, and `tests/e2e`.
- [x] Add strict TypeScript configuration.
- [x] Add formatting, linting, and import-boundary rules.
- [x] Add workspace scripts: `format:check`, `lint`, `typecheck`, `test`, `test:contracts`, `build`, `test:e2e`, `verify`.
- [x] Ensure package dependency direction follows the architecture.

**Verification:** all baseline scripts run from a clean repository.

## 1.2 Continuous integration

- [x] Add CI for install with frozen lockfile.
- [x] Run format, lint, typecheck, unit tests, contract tests, and build.
- [x] Add an optional e2e job with deterministic services.
- [x] Cache dependencies safely.
- [x] Pin third-party actions where practical.
- [x] Add secret scanning and dependency audit.
- [x] Ensure CI does not require production secrets for pull requests.

**Verification:** CI passes on the initial scaffold and fails on an intentionally broken test in a temporary validation branch.

## 1.3 Shared domain model

- [x] Define project, task, policy, check result, evidence bundle, chain transaction, and receipt types.
- [x] Define stable error codes.
- [x] Define supported chain configuration from environment variables.
- [x] Add unit tests for address and identifier normalization.

**Parallelization:** shared-domain agent may work independently, but dependent package agents wait for the integration checkpoint.

**Integration checkpoint 1:** shared schemas are versioned and merged before evidence/API/UI implementations diverge.

---

# Milestone 2 — Evidence protocol

## 2.1 Policy schema

- [x] Implement YAML policy parser using a strict schema.
- [x] Define executable, args, cwd, timeout, required flag, output limits, environment allowlist, and redaction patterns.
- [x] Reject unknown fields unless intentionally allowed by a versioned extension mechanism.
- [x] Reject paths outside repository root.
- [x] Reject shell wrappers and unsafe executable definitions.
- [x] Produce actionable validation errors with file/field context.
- [x] Canonicalize policy and derive `policyHash`.

**Tests:** valid policy, malformed YAML, duplicate keys, path traversal, shell metacharacter cases, unsupported version, stable hash.

## 2.2 Safe process runner

- [x] Execute executable + argv directly without a shell.
- [x] Run in approved working directory.
- [x] Use explicit environment allowlist.
- [x] Stream concise progress to terminal.
- [x] Capture bounded stdout/stderr.
- [x] Enforce timeout and kill child process groups.
- [x] Record start/end/duration/exit code/signal/timeout.
- [x] Support deterministic sequential execution first; add bounded parallel checks only if safe and needed.

**Tests:** spaces, special characters, timeout, child process, large output, nonzero exit, missing executable.

## 2.3 Redaction and truncation

- [x] Implement default secret patterns.
- [x] Implement validated project patterns.
- [x] Redact before persistence and public hashing.
- [x] Record redaction counts and deterministic markers.
- [x] Add output truncation with original byte count and digest.
- [x] Add server-side residual-secret rejection.

**Tests:** seeded fake GitHub token, private key, database URL, split-line secret, false-positive controls, deterministic output.

## 2.4 Git collector

- [x] Locate repository root.
- [x] Capture normalized remote URL without credentials.
- [x] Capture branch, full HEAD object ID, tree ID, author/committer, and commit timestamp.
- [x] Detect staged, unstaged, and untracked changes.
- [x] Capture bounded file/diff summary without storing source content by default.
- [x] Derive EVM-compatible `commitHash` from the full Git object ID.
- [x] Handle detached HEAD and repositories with no commits.

**Tests:** clean repo, dirty repo, untracked files, detached HEAD, credentialed HTTPS remote redaction, SHA formats.

## 2.5 Canonical evidence bundle

- [x] Implement schema version 1.
- [x] Bind task hash, policy hash, Git identity, checks, tool version, and safe environment metadata.
- [x] Derive passing status from required checks and repository constraints.
- [x] Canonicalize JSON and calculate `evidenceHash`.
- [x] Write pretty JSON for humans while hashing canonical bytes.
- [x] Add independent local `verify-bundle` function.

**Tests:** insertion order, altered exit code, altered task hash, missing required check, duplicate check, unsupported schema, stable fixtures.

**Integration checkpoint 2:** evidence fixtures and hash test vectors are frozen before API and contract integration.

---

# Milestone 3 — Monad smart contract

## 3.1 Foundry setup

- [x] Initialize Foundry project in `packages/contracts`.
- [x] Pin compiler and dependency versions.
- [x] Configure formatter, optimizer, RPC environment, and coverage.
- [x] Add deployment and verification scripts.

## 3.2 Implement `DoneBondRegistry`

- [x] Implement compact task storage and explicit status enum.
- [x] Implement `createTask` with task/policy commitments and optional reward.
- [x] Implement assignee-only receipt submission.
- [x] Implement creator-only approval/rejection/cancellation.
- [x] Implement expiry semantics.
- [x] Implement pull-payment credits and reentrancy-safe withdrawal.
- [x] Add custom errors and complete events.
- [x] Prevent duplicate or terminal-state transitions.
- [x] Document every public/external function with NatSpec.

## 3.3 Contract testing

- [x] Unit-test every successful transition.
- [x] Unit-test every access-control and invalid-state revert.
- [x] Test deadline boundaries.
- [x] Test large reward cast/overflow handling.
- [x] Test malicious and reverting withdrawal receivers.
- [x] Add fuzz tests for actors, values, times, and hashes.
- [x] Add invariant handler for solvency and single-credit guarantees.
- [x] Generate gas report and review unexpected costs.

## 3.4 Independent contract audit

- [x] Contract-auditor subagent reviews specification before implementation merge.
- [x] Auditor independently derives state machine and accounting invariants.
- [x] Run static analysis where reproducible.
- [x] Resolve all critical/high findings and document accepted lower-risk findings.

**Verification:** implementer does not self-approve this milestone.

## 3.5 Testnet deployment

- [x] Confirm current official Monad Testnet chain configuration.
- [ ] Fund a dedicated deployment wallet with test MON.
- [ ] Deploy contract.
- [ ] Verify source code in supported explorer.
- [ ] Record address, transaction, chain ID, compiler, optimizer, ABI, and deployment commit.
- [ ] Perform live smoke calls: create task, submit receipt, approve, withdraw.

**Integration checkpoint 3:** ABI and address are versioned before web transaction work begins.

---

# Milestone 4 — Database and API

## 4.1 Database foundation

- [!] Implement Drizzle schema and migrations for all MVP entities. (Code and guarded integration test complete; live disposable PostgreSQL run blocked by unavailable local daemon.)
- [!] Add constraints and indexes for public IDs, chain logs, idempotency, and normalized wallets. (Defined and migration-inspected; live PostgreSQL enforcement run pending.)
- [x] Add typed repository/service layer.
- [x] Add local database development setup.
- [x] Seed only explicit development fixtures; never seed production success data.

## 4.2 Authentication and authorization

- [x] Implement secure browser authentication.
- [x] Implement wallet ownership association/signature challenge if used.
- [x] Add project ownership/member checks.
- [x] Add authorization matrix tests.
- [ ] Ensure public endpoints use a strict field allowlist.

## 4.3 CLI tokens

- [x] Generate cryptographically secure project-scoped tokens.
- [x] Show plaintext once.
- [x] Store only a slow/strong hash or keyed digest appropriate for high-entropy tokens.
- [x] Implement revocation, last-used timestamp, and rate limiting.
- [x] Add log redaction for token headers.

## 4.4 Projects and policies API

- [x] Project CRUD.
- [x] Policy upload/validation/canonicalization.
- [x] Policy activation/version history.
- [x] Repository metadata validation.
- [x] Idempotent writes and stable errors.

## 4.5 Tasks API — COMPLETE

- [x] Create task draft with canonical `taskHash` and policy binding.
- [x] Validate assignee, deadline, reward, and supported network.
- [x] Create chain transaction intent.
- [x] Persist submitted transaction hash and reconcile confirmation/event.
- [x] Handle wallet rejection, replacement, revert, and unknown status.

## 4.6 Evidence API

- [x] Accept authenticated, bounded evidence uploads.
- [x] Validate schema and required checks.
- [x] Recompute policy/task/evidence commitments (evidence hash is server-recomputed via `canonicalKeccak256`; submitted `task.taskHash`/`policy.policyHash` are compared against the current DB task/policy record and rejected with `EVIDENCE_HASH_MISMATCH` on drift). Git commit derivation is verified CLI-side before upload (`packages/evidence` `GIT_COMMIT_MISMATCH`); the API has no independent repository access to re-derive it.
- [x] Run residual secret checks (server re-scans redacted check output with `findResidualSecrets` before persisting; `EVIDENCE_RESIDUAL_SECRET` on a hit — defense in depth against a CLI that redacted incorrectly).
- [x] Store safe bundle in object storage or database for MVP (metadata + checks persisted relationally in `evidence_bundles`/`verification_checks`).
- [x] Persist check summaries transactionally (`DoneBondRepository.persistEvidence`, one transaction for idempotency key, bundle row, checks, and audit event).
- [ ] Return unsigned receipt call parameters only for passing evidence — deferred to 4.7 (Public receipt API); requires chain/contract calldata wiring analogous to task chain-intent and is out of scope for the upload/list/detail endpoints built here.
- [x] Prevent conflicting replay/idempotency requests (`DB_IDEMPOTENCY_CONFLICT` → `EVIDENCE_UPLOAD_CONFLICT`, 409; verified in `packages/db` and `apps/web` tests).

Routes: `POST /api/v1/projects/[projectId]/evidence` (submit), `GET /api/v1/projects/[projectId]/tasks/[taskId]/evidence` (list, keyset-paginated), `GET /api/v1/evidence/[evidenceId]` (public detail). The listing route is nested under the project (not the flat `/api/v1/tasks/[taskId]/evidence` shape sketched mid-session) because CLI-token authentication is project-bound and must know the project before authenticating — matches the existing `projects/[projectId]/policies/[policyId]` nesting convention.

**Verification:**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:contracts && pnpm build
```

All pass: shared 16/16, db 69/70 (1 pre-existing skipped Postgres integration test), cli 22/22, web 82/82 (10 new evidence-handlers tests, 3 new evidence-runtime tests), contracts 32/32, production build succeeds with the three new routes registered. `pnpm test:e2e` was not run — it requires `NEXT_PUBLIC_APP_URL`/`AUTH_SECRET` local env setup that has never been configured in this repo (only `.env.example` exists) and was not part of this task's scope.

## 4.7 Public receipt API

- [ ] Return only allowed fields.
- [ ] Provide safe bundle download.
- [ ] Include chain/explorer metadata and integrity status.
- [ ] Add caching without serving stale pending lifecycle state incorrectly.

## 4.8 Event indexing and reconciliation

- [ ] Implement contract event decoder.
- [ ] Store event uniquely by chain/tx/log index.
- [ ] Reconcile pending transactions.
- [ ] Make processing idempotent and reorg-aware to the extent appropriate for testnet MVP.
- [ ] Add admin/debug visibility without exposing sensitive data.

**Integration checkpoint 4:** golden task/evidence fixtures pass client and server hash comparisons.

---

# Milestone 5 — CLI

## 5.1 CLI skeleton

- [x] Package executable as `donebond`.
- [x] Add version/help/error conventions.
- [x] Add structured nonzero exit codes.
- [x] Ensure secrets never appear in debug logs.

## 5.2 `donebond init`

- [x] Discover repository.
- [x] Generate policy template without overwriting existing file.
- [x] Ask for API URL/project ID/token through safe input.
- [x] Store configuration with restrictive permissions where supported.
- [x] Validate connection.

## 5.3 `donebond policy validate`

- [x] Parse and display checks.
- [x] Show exact executable/args/cwd/timeout.
- [x] Explain unsafe or unsupported fields.
- [x] Print policy hash.

## 5.4 `donebond task pull`

- [x] Fetch task and safe acceptance criteria.
- [x] Verify project/policy match.
- [x] Save local task manifest.
- [x] Avoid modifying implementation files.

## 5.5 `donebond verify`

- [x] Confirm task and policy hashes.
- [x] Collect Git state.
- [x] Execute checks.
- [x] Render concise progress and final table.
- [x] Produce evidence JSON even on failure for diagnostics.
- [x] Refuse passing status for dirty/stale commit according to policy.
- [x] Return nonzero exit when required verification fails.

## 5.6 `donebond submit`

- [ ] Validate bundle locally.
- [ ] Upload with idempotency key and retry policy.
- [ ] Compare server commitments.
- [ ] Print public receipt and web transaction link/instructions.
- [ ] Never sign with or request a raw private key.

## 5.7 `donebond receipt verify`

- [ ] Download public bundle.
- [ ] Recompute evidence commitment.
- [ ] Read contract state/event through RPC.
- [ ] Compare all commitments and print independently verified status.

## 5.8 CLI distribution

- [ ] Build portable package.
- [ ] Test install from packed tarball in a clean temporary directory.
- [ ] Document Node/runtime requirements.
- [ ] Publish only if credentials and package name are ready; local `pnpm dlx` path is acceptable for the hackathon demo.

---

# Milestone 6 — Web product

## 6.1 Design system

- [x] Define typography, spacing, surface, border, status, and code styles (`packages/ui/src/tokens.css`, extends the existing dark palette/Geist fonts in `apps/web/src/app/styles.css` rather than replacing it).
- [x] Build accessible primitives for button, input, textarea, dialog, toast, tabs, status badge, hash display, check result, and transaction state.
- [x] Avoid generic card overload and decorative Web3 clichés (five status tones, not three; hash truncation over hex-soup; no gradients/neon).
- [x] Add responsive and reduced-motion behavior (`prefers-reduced-motion` zeroes the motion token scale).

`CheckResult`/`TransactionState` status props are typed directly off `CheckResult["status"]`/`ChainTransaction["status"]` from `@donebond/shared` (not a redefined parallel union), so they cannot drift from `CheckStatusSchema`/`ChainTransactionStatusSchema`. Dialog implements the WAI-ARIA APG modal pattern (real focus trap, Escape-to-close, focus restore); Tabs implements roving-tabindex keyboard navigation. Interactive/keyboard logic is extracted into pure functions in `packages/ui/src/lib/` and unit-tested with `node:test` (no jsdom/RTL in this repo) since untested accessibility logic isn't verified accessibility.

**Verification:** `pnpm --filter @donebond/ui typecheck/build/test` (28/28), `pnpm --filter @donebond/web typecheck/build`, `pnpm format:check`, `pnpm lint`, full `pnpm test` (12/12 workspace tasks, no regressions). `apps/web/src/app/page.tsx` renders `Stack`/`Text`/`Heading`/`CheckResult` from `@donebond/ui` as a real integration proof point (full landing redesign is 6.2, separate).

## 6.2 Landing and onboarding

- [ ] Clear product pitch.
- [ ] Explain the evidence/chain distinction accurately.
- [ ] Show install command and real sample receipt.
- [ ] Provide “Create project” path.

## 6.3 Project screens

- [ ] Project list/create/detail.
- [ ] Policy status and version.
- [ ] CLI token creation/revocation.
- [ ] Copyable setup commands.

## 6.4 Task creation

- [ ] Acceptance-criteria editor.
- [ ] Assignee wallet and deadline validation.
- [ ] Policy summary and commitment preview.
- [ ] Optional MON reward.
- [ ] Network/contract/amount review.
- [ ] Wallet rejection/pending/revert/recovery states.

## 6.5 Task detail and receipt

- [ ] Human-readable requested outcome.
- [ ] Git commit and repository state.
- [ ] Deterministic check results.
- [ ] Redacted output previews.
- [ ] Task/policy/evidence/commit hashes.
- [ ] Transaction and explorer links.
- [ ] Creator approve/reject controls with permission/state guards.
- [ ] Contributor withdrawal flow.

## 6.6 Public proof page

- [ ] No-login route with stable public ID.
- [ ] Integrity result and caveat.
- [ ] Safe bundle download.
- [ ] Responsive hash and check presentation.
- [ ] Metadata suitable for sharing.

## 6.7 Error and empty states

- [ ] First project/task.
- [ ] No receipt yet.
- [ ] Failed evidence.
- [ ] RPC unavailable.
- [ ] Unsupported wallet/network.
- [ ] Pending or replaced transaction.
- [ ] Evidence unavailable or hash mismatch.

**Integration checkpoint 5:** the entire UI uses real API/contract state; no hardcoded successful task remains.

---

# Milestone 7 — End-to-end integration

## 7.1 Sample repository fixture

- [ ] Create a tiny, original sample API with a deliberately missing rate-limit behavior.
- [ ] Add a test that initially fails for the correct reason.
- [ ] Ensure the final implementation is small enough to explain in the demo.
- [ ] Never manipulate test results; the code change must make the test pass.

## 7.2 Golden failure-to-pass flow

- [ ] Create project and task.
- [ ] Pull task through CLI.
- [ ] Run failed verification.
- [ ] Confirm failed bundle cannot be submitted onchain.
- [ ] Implement and commit real fix.
- [ ] Run passing verification.
- [ ] Upload and compare hashes.
- [ ] Submit receipt on Monad.
- [ ] View proof and explorer.
- [ ] Approve and withdraw funded reward.

## 7.3 Recovery flows

- [ ] Wallet rejection leaves no false success state.
- [ ] RPC timeout is reconciled later.
- [ ] Duplicate API and contract actions are safe.
- [ ] Refresh during pending transaction recovers state.
- [ ] Invalid/altered bundle is rejected.

## 7.4 Independent acceptance run

- [ ] A verifier subagent starts from a fresh clone and written instructions.
- [ ] It runs setup and the golden flow without implementer assistance.
- [ ] Every failure is filed with severity and reproduction.
- [ ] Critical/high issues are fixed and rerun.

---

# Milestone 8 — Production hardening

## 8.1 Security review

- [ ] Complete `SECURITY.md` checklist.
- [ ] Run secret scan across history.
- [ ] Run dependency audit.
- [ ] Review auth/IDOR/CSRF/XSS controls.
- [ ] Test evidence leakage and redaction.
- [ ] Resolve contract audit findings.

## 8.2 Reliability and observability

- [ ] Structured logs and correlation IDs.
- [ ] Metrics for validation failures, API errors, pending transactions, and event lag.
- [ ] Health endpoint that checks dependencies safely.
- [ ] Timeouts and retries with jitter for external calls.
- [ ] No sensitive evidence in logs.

## 8.3 Accessibility and responsive QA

- [ ] Keyboard-only core flow.
- [ ] Automated accessibility scan.
- [ ] Manual mobile and desktop checks.
- [ ] Status not color-only.
- [ ] Long hashes/output do not break layout.

## 8.4 Performance

- [ ] Analyze web bundle.
- [ ] Avoid blocking unnecessary RPC calls during first render.
- [ ] Paginate task/receipt lists.
- [ ] Bound evidence payloads.
- [ ] Cache public immutable data safely.

---

# Milestone 9 — Deployment

## 9.1 Environments

- [ ] Define local, preview, and production/testnet environments.
- [ ] Validate environment variables at startup.
- [ ] Keep secrets in platform secret stores.
- [ ] Add safe database migration procedure and rollback note.

## 9.2 Web/API/database deployment

- [ ] Provision production database.
- [ ] Deploy web/API.
- [ ] Configure object storage if used.
- [ ] Configure public base URL and chain metadata.
- [ ] Run migrations.
- [ ] Verify security headers and HTTPS.

## 9.3 Production smoke test

- [ ] Sign in.
- [ ] Create project/token.
- [ ] Create funded task on testnet.
- [ ] Run CLI from a fresh machine/user directory.
- [ ] Submit receipt.
- [ ] Approve and withdraw.
- [ ] Verify explorer and public proof links.
- [ ] Save safe screenshots and transaction references.

---

# Milestone 10 — Documentation, demo, and submission

## 10.1 Public README

- [ ] Problem and solution.
- [ ] Architecture diagram.
- [ ] Why Monad is necessary.
- [ ] Setup prerequisites.
- [ ] Local development.
- [ ] Contract deployment/verification.
- [ ] CLI workflow.
- [ ] Environment variables without secrets.
- [ ] Testing commands.
- [ ] Security limitations and threat model link.
- [ ] Hosted URL, contract address, explorer, demo video.

## 10.2 Demo preparation

- [ ] Follow `DEMO_AND_SUBMISSION.md`.
- [ ] Keep video below three minutes.
- [ ] Use one coherent real flow.
- [ ] Pre-fund only with test MON and never expose keys.
- [ ] Record at readable zoom with no notifications/secrets.
- [ ] Rehearse an offline fallback explanation without replacing the real live proof.

## 10.3 Judge-focused audit

- [ ] No placeholder dashboard metrics.
- [ ] No button that returns unconditional success.
- [ ] No suspicious imported history or giant unexplained commit.
- [ ] Commit chronology shows incremental work.
- [ ] Public repository and hosted app work in a logged-out browser.
- [ ] Contract source is verified.
- [ ] Demo links and public proof are stable.
- [ ] One evaluator can identify the personal problem, USP, onchain necessity, and working result in under one minute.

## 10.4 Submission

- [ ] Project name and concise tagline.
- [ ] Problem statement.
- [ ] Solution and USP.
- [ ] Hosted URL.
- [ ] Public GitHub URL.
- [ ] Network category.
- [ ] Contract address.
- [ ] Public demo video URL.
- [ ] Social/build-in-public post if targeting viral prize.
- [ ] Submit before the official deadline and save confirmation.

---

# Stretch backlog — only after all release gates pass

- [ ] GitHub status-check integration
- [ ] GitHub App issue/task import
- [ ] Multiple verifier signatures
- [ ] Dispute window and arbitrator role
- [ ] Private encrypted evidence
- [ ] x402 agent-to-agent payment endpoint
- [ ] Reputation based on accepted verified outcomes
- [ ] Policy marketplace/templates
- [ ] Organization/RBAC support
- [ ] Remote ephemeral runners

---

# Work log

Agents append entries using this exact shape:

```text
## YYYY-MM-DD HH:MM TZ — <agent/role> — <task IDs>
- Branch/worktree:
- Summary:
- Files changed:
- Verification commands:
- Results:
- Security/privacy notes:
- Remaining risks/blockers:
- Commit:
```

Do not rewrite or erase earlier entries except to correct an explicitly documented mistake.

## 2026-07-17 03:34 IST — Codex/primary coordinator — 0.1 (partial), 0.2
- Branch/worktree: `main` in `/Users/salescode/Documents/Code/DoneBond`
- Summary: Initialized a fresh repository with zero imported history; configured the required local personal identity and SSH-alias remote; added repository metadata, safe environment template, licensing, contribution and issue guidance, runtime/package-manager pins, and a portable checksum manifest. Milestone 0.1 remains blocked only on GitHub repository creation and SSH authentication; Milestone 0.2 is complete.
- Files changed: Initial tracked build kit plus `.editorconfig`, `.env.example`, `.github/ISSUE_TEMPLATE/*`, `.gitignore`, `.npmrc`, `.nvmrc`, `CONTRIBUTING.md`, `LICENSE`, `MANIFEST.sha256`, `package.json`, `pnpm-lock.yaml`, `README.md`, and `task.md`.
- Verification commands: `bash scripts/verify-git-identity.sh`; `shasum -a 256 -c MANIFEST.sha256`; secret-pattern `rg` scan; `git diff --cached --check`; `pnpm install --frozen-lockfile`; local `git clone --no-local`; `git log -1 --format=...`; `git rev-list --all --count`; `ssh -T git@github-personal`.
- Results: Identity script passed; 38 manifest entries passed; secret-pattern scan returned zero matches; diff check passed; frozen install passed with pnpm 11.6.0; clean clone was clean and contained required records; root commit author/committer both matched `Vedant817 <vedantmahajan271@gmail.com>`; history count was 1 after the baseline commit. SSH failed with `Permission denied (publickey)` and the GitHub connector returned 404 for `Vedant817/donebond`.
- Security/privacy notes: No credentials were added. RPC and contract values remain empty until verified/configured; only the officially confirmed testnet chain ID is present. Push is prohibited until personal SSH authentication succeeds.
- Remaining risks/blockers: User must create or authorize the public `Vedant817/donebond` repository and configure the `github-personal` SSH key. Foundry, Solidity compiler, and GitHub CLI are not installed in the current environment.
- Commit: `243db35b0029d777e4ed5ef34fdf96a0bac52545`

## 2026-07-17 03:43 IST — Codex/primary coordinator — 1.1
- Branch/worktree: `main` in `/Users/salescode/Documents/Code/DoneBond`
- Summary: Added a ten-project pnpm/Turborepo workspace; strict shared TypeScript configs; pinned and locked current Next.js/React/Turbo toolchain; root formatting, lint, typecheck, test, contract-test, build, e2e, and verify scripts; an executable dependency-boundary policy with a negative regression test; a minimal App Router web surface; and a real Playwright HTTP smoke test. Explicitly approved only the `sharp` and `unrs-resolver` dependency build scripts required by the reviewed toolchain.
- Files changed: Root workspace/config/lock files; `apps/cli/**`; `apps/web/**`; `packages/{config,contracts,db,evidence,shared,ui}/**`; `scripts/check-workspace-boundaries*`; `tests/e2e/**`; `MANIFEST.sha256`; `task.md`.
- Verification commands: `pnpm install --frozen-lockfile`; `pnpm verify`; `pnpm turbo ls`; `pnpm turbo run build --dry-run=json`; `pnpm peers check`; `shasum -a 256 -c MANIFEST.sha256`; local `git clone --no-local`; `git status --short`; `bash scripts/verify-git-identity.sh`; `git diff --check`.
- Results: Clean-clone manifest and frozen install passed; formatting and lint passed; boundary validator passed and its prohibited shared-to-app dependency test failed the injected graph as expected; strict typecheck passed in 6 packages; 2 boundary tests passed; 1 contract-package specification check passed; production build passed in 6 packages including Next.js 16.2.10; 1 Playwright HTTP e2e test passed; Turbo listed all 9 named workspace packages and included `@donebond/web#build`; peer check found no issues; clean-clone worktree stayed clean after verification.
- Security/privacy notes: No secrets or runtime credentials were added. Next.js 16.2.10 and React 19.2.7 were selected from the current package registry; unsupported ESLint 10 was replaced with compatible ESLint 9.39.5 rather than suppressing rules. Workspace/output tracing is pinned to the repository root, and generated build/test state is ignored.
- Remaining risks/blockers: Contract test command currently verifies only the scaffold/spec binding because Foundry implementation is Milestone 3. Real browser rendering/a11y tests and product UI are later milestones. Remote repository creation/SSH authentication remains blocked under 0.1, so commits are not pushed.
- Commit: `2f64b580bd8d7f90230518c362ef4ee1dbcecba7` with generated-artifact correction `8c276b88a0a9b363461122267db168487d0b2e4c`

## 2026-07-17 10:21 IST — Codex/primary coordinator + independent reviewer — 1.3
- Branch/worktree: `main` in `/Users/salescode/Documents/Code/DoneBond`; read-only review in `review/foundations`.
- Summary: Froze strict version-1 project/task/policy/evidence/transaction/receipt schemas, canonical GitHub/EVM/Git identifiers, stable API errors, environment-derived Monad configuration, RFC 8785 commitment rules, and a replay-safe EIP-712 verifier boundary. Structural receipts cannot self-claim verified integrity; trusted parsing requires the immutable verifier from deployment state and recovers its signature.
- Files changed: `packages/shared/**`, `schemas/evidence-bundle.schema.json`, `.env.example`, `templates/donebond.policy.example.yml`, `ARCHITECTURE.md`, `CONTRACT_SPEC.md`, `DECISIONS.md`, ADR-004, ADR-005, workspace test wiring, lockfile, and tracker.
- Verification commands: `pnpm format:check`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm build`; shared build/test/typecheck; JSON schema parse; `git diff --check`; `bash scripts/verify-git-identity.sh`; independent adversarial review and targeted reproductions.
- Results: Full formatting, lint, typecheck, test, and production build gates passed; shared suite passed 15/15; schema JSON parsed; identity and diff checks passed. Independent reviewer reproduced and then verified fixes for nonzero-exit passing checks, zero-required policies, credentialed remotes, dirty-state contradictions, arbitrary receipt states/digests, signature mutation, and self-declared attacker verifiers; no critical/high finding remains.
- Security/privacy notes: Evidence status is derived fail-closed from required check/process outcomes; canonical public repository identity cannot carry credentials; mixed-case EVM checksums are validated before lowercase commitment encoding; RPC credentials are rejected; verifier integrity requires trusted deployment configuration.
- Remaining risks/blockers: Canonical hashing execution and frozen evidence vectors are task 2.5. EIP-712 verifier availability/key rotation remains an explicit MVP operational dependency. Remote publication remains blocked by missing personal GitHub SSH authorization.
- Commit: `1ffd64b2a0e518f36f871619357fdcf5c0ee08c5`

## 2026-07-17 10:24 IST — CI engineer + Codex/integrator — 1.2
- Branch/worktree: `feat/ci` in `/Users/salescode/Documents/Code/DoneBond-ci`, integrated to `main`.
- Summary: Added least-privilege CI with frozen installs, SHA-pinned actions, safe pnpm caching, isolated quality/contract/security jobs, deterministic optional e2e, a redaction-safe tracked-history secret scanner, production dependency audit, and local security command aliases. Root JavaScript gates intentionally exclude Foundry and run the contract suite through its dedicated pinned toolchain job.
- Files changed: `.github/workflows/ci.yml`, `scripts/scan-secrets.mjs`, `scripts/ci/scan-secrets.test.mjs`, root scripts, manifest, and tracker.
- Verification commands: Full local format/lint/typecheck/unit/build/contract/e2e gates; `actionlint 1.7.10`; scanner unit tests; history scan; `pnpm audit --prod --audit-level=critical`; intentionally broken temporary test followed by restoration.
- Results: Local quality suite passed; contract suite passed 28/28; Playwright passed 1/1; scanner passed 4/4 and scanned 148 tracked/history files without exposing match values; actionlint passed; intentional broken test failed as required; audit passed the critical threshold with one known moderate PostCSS advisory.
- Security/privacy notes: Workflow permissions are read-only, checkout credentials are not persisted, production secrets are not referenced for pull requests, and action revisions/tool versions are pinned.
- Remaining risks/blockers: A hosted GitHub Actions run cannot be observed until the external `Vedant817/donebond` repository and personal SSH authentication are available; local workflow validation is complete.
- Commit: `75154c36d7c143607988fa45c9f2a7db50e5c913`; root-script integration `1d4b33afee93902038dfb1dcf5cfb9c9c283c7bf`.

## 2026-07-17 10:32 IST — Contract engineer + independent contract auditor + Codex/integrator — 3.1–3.4
- Branch/worktree: `feat/contracts` in `/Users/salescode/Documents/Code/DoneBond-contracts`, integrated and hardened on `main`; independent read-only audit from `review/foundations`.
- Summary: Implemented the immutable `DoneBondRegistry` with EIP-712 passing-evidence attestations, explicit terminal lifecycle, optional native MON escrow, creator/assignee authorization, expiry, terminal rejection refunds, pull-payment settlement, replay protection, complete events/errors/NatSpec, pinned vendored dependencies, deployment tooling, and adversarial/fuzz/invariant coverage. Post-audit hardening added an EOA-verifier deployment guard, independent cross-language digest vector, forced-MON surplus case, and non-degenerate stateful exploration.
- Files changed: `packages/contracts/**`, `.env.example`, `SECURITY.md`, manifest, and tracker.
- Verification commands: `forge fmt --check`; `forge build`; `forge test -vvv`; `forge test --gas-report`; `forge coverage --report summary`; `forge lint`; `forge build --sizes`; `pnpm test:contracts`; independent source/spec audit; post-fix targeted re-audit.
- Results: 32/32 tests passed: 25 unit/fuzz, 3 adversarial, 4 invariants. Fuzz tests ran 512 cases each. Every invariant ran 256 runs/16,384 calls with zero handler reverts and thousands of successful create/submit/approve/reject/cancel/expire/withdraw actions. Registry coverage is 100% lines/functions, 99.15% statements, 96% branches. Shared/Solidity EIP-712 digest `0xc319…` matches. Auditor reports no remaining critical/high findings.
- Security/privacy notes: Attestations bind chain, contract, task/policy/assignee/evidence/commit/expiry and cannot replay; checks-effects-interactions, reentrancy guard, reward zeroing, aggregate accounting, and pull payments prevent duplicate settlement. Forced funds produce harmless surplus under `balance >= liabilities`. No deployment secrets were persisted.
- Remaining risks/blockers: Receipt-submitted rewards have no unilateral review timeout; ECDSA EOA verifier rotation requires a new deployment; validator timestamp skew requires practical buffers. These accepted MVP risks are documented. Slither/Aderyn/Solhint/Mythril/Semgrep were unavailable; Foundry lint produced only documented timestamp warnings. Monad Testnet deployment and live settlement remain task 3.5 and require an externally funded wallet/RPC.
- Commit: implementation `708a9410bc174e668317ed4852a3c89603a43ea8`; audit hardening `78ae8ef7e58f9676c060e0fd9188aa891a4ff0d5`.

## 2026-07-17 10:33 IST — Codex/release integrator — 3.5 (partial)
- Branch/worktree: `main`.
- Summary: Reconfirmed current official Monad Testnet chain ID, public RPC, explorer, and native token; synchronized safe public defaults and the deployment runbook; versioned the reviewed registry ABI with a deterministic source-drift check.
- Files changed: `.env.example`, `DEPLOYMENT.md`, `packages/contracts/abi/DoneBondRegistry.json`, contract ABI check/export metadata, manifest, and tracker.
- Verification commands: Official Monad Developer Portal/documentation lookup; attempted `cast chain-id`, `cast block-number`, and explorer HEAD preflight; `pnpm abi:check`; focused shared EIP-712 vector test.
- Results: Official primary sources report chain ID `10143`, RPC `https://rpc.testnet.monad.xyz`, explorer `https://testnet.monadscan.com`, and native `MON`. Committed ABI exactly matches pinned Solidity output and the fixed vector passes. Shell preflight could not resolve external DNS in this execution environment, so no transaction or live RPC result is claimed.
- Security/privacy notes: No deployer/verifier key, wallet address, or credential was added. Explorer API credentials remain blank.
- Remaining risks/blockers: Deployment, source verification, and live create/submit/approve/withdraw require a dedicated funded Testnet wallet, verifier key/address, working outbound RPC DNS, and explorer verification access.
- Commit: network configuration `e526f713ed02c73a3abc86e6415874bbffa62209`; ABI versioning `c4f86d04d1fa93c73408603f23c03e34fb8aca6f` with formatting correction `5ce6d3ffe64adf33a4c62643d831980264abad06`.

## 2026-07-17 10:58 IST — Evidence engineer + independent reviewer + Codex/integrator — 2.1–2.5
- Branch/worktree: `feat/evidence-engine` in `/Users/salescode/Documents/Code/DoneBond-evidence`, integrated to `main`.
- Summary: Implemented the complete EvidenceBundleV1 protocol: strict duplicate-safe YAML policies; RFC 8785 policy/task/evidence commitments; direct argv execution with no shell, allowlisted environment, realpath confinement, bounded output, timeout and process-group termination; deterministic secret redaction and residual scanning; exact Git commit/tree/branch/remote/dirty-state collection; privacy-minimized public projection; atomic restrictive bundle writes; frozen commitment vectors; and independent fail-closed verification.
- Files changed: `packages/evidence/**` and `pnpm-lock.yaml`.
- Verification commands: `pnpm install --frozen-lockfile`; evidence build/typecheck/test; root format/lint/typecheck/test/build; current-tree secret scan; production critical dependency audit; `git diff --check`; independent mutation and repository-constraint review.
- Results: Evidence suite passed 35/35 after integration; root typecheck passed 6/6 workspace tasks. Independent reviewer reproduced the original base-commit verification gap and verified its correction: a passing base-bound bundle now requires matching independently collected repository context. Branch and remote-owner forgeries, unsafe paths, shell wrappers, timeouts, output floods, malformed output, residual secrets, and commitment mutations fail closed. No critical/high finding remains.
- Security/privacy notes: Author/committer identities and absolute local paths remain outside the public bundle. Raw V1 bundles retain normalized repository identity and changed path names, so a future public API must deny raw downloads for private projects or use a separately specified safe projection. EvidenceBundleV1 cannot encode repository-constraint failure outcomes; branch/remote violations therefore refuse bundle creation and base ancestry requires trusted local context.
- Remaining risks/blockers: One unrelated moderate PostCSS production advisory remains below the critical audit gate. Public/private bundle access control is required in task 4.7. Live chain anchoring remains blocked by the documented task 3.5 deployment credentials/network prerequisites.
- Commit: `c0fe96d52f4cc3afde89c5c9bd03c10bc3e4e9c0`.

## 2026-07-17 11:20 IST — CLI engineer + independent reviewer + Codex/integrator — 5.1–5.2
- Branch/worktree: `feat/cli-foundation` in `/Users/salescode/Documents/Code/DoneBond-cli`, integrated to `main`.
- Summary: Added the `donebond` executable with stable human/JSON help, version, errors, and exit codes; repository discovery; safe policy initialization; explicit offline mode; bounded hidden/stdin token input; real API project validation; and configuration stored outside the repository with restrictive permissions and symlink/ownership checks.
- Files changed: `apps/cli/**`.
- Verification commands: CLI build/typecheck/test; root format/lint/boundaries; `git diff --check`; tracked/history secret scan; identity checker; independent adversarial review with invalid HTTP 200, oversized response, mismatched project, failed-init rollback, and symlinked XDG root reproductions.
- Results: CLI suite passed 10/10 after integration. Invalid/non-normalized project IDs, HTML or mismatched/oversized successful responses, unsafe config roots, symlink targets, overwrite without force, non-Git directories, and conflicting options fail closed. Failed online validation creates no `.donebond` directory. Current tracked secret scan passed 180 files. No critical/high finding remains.
- Security/privacy notes: Tokens are never accepted on argv, never printed, and persist only at mode 0600 beneath mode 0700 directories on supported POSIX systems. API URLs reject credentials, query, fragments, and insecure non-local transport. Portable Node filesystem APIs cannot eliminate every TOCTOU race, so ownership, symlink, and permission checks are repeated immediately around operations.
- Remaining risks/blockers: The local config uses OS filesystem protection rather than a platform keychain; a keychain backend is a post-MVP hardening option. Remaining CLI verification, upload, receipt, and distribution commands are tasks 5.3–5.8.
- Commit: `f9a3b9925f508c3b4f53f11868663f800d912f05`.

## 2026-07-17 11:31 IST — Codex/primary implementation agent — 5.3
- Branch/worktree: `main`.
- Summary: Added `donebond policy validate` to parse the real strict evidence policy without executing it, show each check's exact executable, argument vector, working directory, timeout and required state, and print the RFC 8785-derived policy commitment in human or structured JSON output.
- Files changed: `apps/cli/**`, shared/evidence build wiring, manifest, and tracker.
- Verification commands: `pnpm --filter @donebond/cli test`; CLI typecheck; root lint/boundaries; root format check; tracked secret scan; `git diff --check`; focused unsafe-command and outside-repository policy tests.
- Results: CLI suite passed 12/12. Valid policy output reproduces a stable 32-byte policy hash and exact execution parameters. Shell-wrapper policy and a policy outside the repository fail with stable configuration/repository exit codes and actionable evidence-engine messages. Package runtime imports the reviewed workspace exports rather than internal build paths.
- Security/privacy notes: Validation never executes a policy command. Existing realpath containment, strict schema, duplicate-key rejection, shell-wrapper rejection, and safe error rendering remain authoritative. A delegated review attempt was unavailable, so the primary reran focused acceptance and workspace gates directly.
- Remaining risks/blockers: Task pull, command execution/evidence generation, upload, and independent receipt verification remain tasks 5.4–5.7.
- Commit: `1f8025f755e8c48122152713dded93b06b8c72a0`.

## 2026-07-17 11:48 IST — Database engineer + two independent reviews + Codex/integrator — 4.1 (partial)
- Branch/worktree: `feat/database-foundation` in `/Users/salescode/Documents/Code/DoneBond-backend`, integrated to `main`.
- Summary: Added the complete Drizzle/PostgreSQL MVP schema, generated migration, certificate-verified connection configuration, local Compose workflow, typed transactional repository, exact shared lifecycle enums, cross-project composite integrity, member-scoped reads, atomic audit/idempotency bindings, strict evidence-policy check matching, audited reorg handling, and replacement-safe chain transaction transitions.
- Files changed: `packages/db/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, manifest, and tracker.
- Verification commands: frozen install; DB build/typecheck/test; package consumer import from `apps/web`; Drizzle generation freshness; Compose configuration; root lint/format/boundaries; tracked/history secret scan; independent false-evidence, actor-scope, reorg, replacement, and package-runtime reproductions.
- Results: DB suite passed 23/23 deterministic tests with one guarded real-PostgreSQL integration test skipped. Built `@donebond/db` imports successfully from a consumer. Frozen install now passes with reviewed Drizzle/Postgres dependencies. The two review rounds found false policy completeness, caller-controlled actor scope, invalid runtime exports, and replacement bypasses; all have regression coverage and no critical/high code finding remains.
- Security/privacy notes: TLS requires certificate validation and optionally a private CA; disabling TLS is loopback-only. Tokens persist only as exact lowercase 64-hex digests. State-changing resources, idempotency bindings, and audit entries share transactions. `esbuild` lifecycle scripts are explicitly allowed because three locked versions are required by the reviewed `drizzle-kit` development toolchain; no production runtime depends on Drizzle Kit.
- Remaining risks/blockers: The guarded migration/constraint integration test must run against an explicitly confirmed disposable database ending in `_test`. Docker/OrbStack and local PostgreSQL are unavailable in this environment, so schema execution, rollback, and concurrency behavior are not yet claimed and the first two 4.1 items remain blocked rather than done.
- Commit: foundation `a17e911`; integrity remediation `a661b18`; replacement hardening `5a6ff30`; lock/toolchain integration recorded by the following coordinator commit.

## 2026-07-17 12:02 IST — Codex/primary agent + independent evidence reviewer — 5.4
- Branch/worktree: `main` with read-only independent review.
- Summary: Added authenticated `donebond task pull`, restrictive repository-scoped credential loading, strict bounded task response parsing, exact requested-task/project/local-policy checks, server-independent canonical task-hash recomputation, and atomic mode-0600 local task manifests ignored by Git.
- Files changed: `apps/cli/**`, manifest, and tracker.
- Verification commands: CLI build/typecheck/test; root lint/format/boundaries; tracked secret scan; `git diff --check`; independent path-safety reproduction and commitment-mutation review.
- Results: CLI suite passed 16/16. Negative cases cover altered task hash, requested ID, project, policy, malformed payload, oversized response, replaced credential-root symlink, task/policy leaf symlinks, and a `.donebond` parent symlink targeting source. Independent reproduction confirms the prior parent-symlink write flaw now returns `REPOSITORY_UNSAFE_PATH` before credentials/network and preserves the implementation sentinel. No critical/high finding remains.
- Security/privacy notes: Bearer tokens remain outside the repository and logs; GET redirects are disabled, responses are capped at 64 KiB with fatal UTF-8 parsing, and task content is strict-schema validated. Portable path APIs leave a low same-user TOCTOU possibility if another local process swaps `.donebond` between validation and rename; the directory and leaf are validated and atomic rename limits the window.
- Remaining risks/blockers: Real task pulling awaits task 4.5 API completion. Local contract verification and evidence generation are task 5.5.
- Commit: `9555e7c451cb08c72d4777af9c161eb79934f0c3`.

## 2026-07-17 12:34 IST — Codex/primary agent + independent evidence reviewer — 5.5
- Branch/worktree: `main` with read-only independent review.
- Summary: Added `donebond verify` as a real local verification workflow: it validates the pulled task and committed policy, preflights exact Git remote/branch/base/commit constraints before execution, runs direct-argv policy checks with concise progress, recollects Git state afterward, and writes canonical EvidenceBundleV1 output or an explicit diagnostic-only artifact for repository failures that the frozen public schema cannot represent.
- Files changed: `apps/cli/**`, evidence runner progress metadata and protocol documentation, shared Policy V1 schema, policy regression tests, manifest, and tracker.
- Verification commands: shared, evidence, and CLI build/typecheck/test; root lint/boundaries and format check; `git diff --check`; independent adversarial review and rerun.
- Results: Shared passed 15/15, evidence passed 36/36, and CLI passed 22/22. Tests execute actual processes and cover passing/failed checks, initial dirty state, wrong remote/target branch without command execution, check-induced HEAD mutation, exact human command/table output, wrong commit, unsafe output paths, and Policy V1 rejection of dirty-tree permission. Independent re-review reports no remaining critical/high/medium findings.
- Security/privacy notes: Commands use the reviewed shell-free evidence runner; only allowlisted environment variable names are displayed, never values. Known repository mismatches skip all commands. Policy V1 now requires a clean tree because its frozen passing semantics cannot honestly represent dirty-tree permission; `false` is rejected instead of silently producing ambiguous evidence.
- Remaining risks/blockers: Upload and server-side commitment comparison require task 5.6 and backend evidence APIs. Live receipt anchoring remains blocked by task 3.5 external testnet credentials/network access.
- Commit: `e194d670ce259c6f7d23c6402f0edac8c98b34c2`.

## 2026-07-17 12:40 IST — Database engineer + Codex/integrator + independent security reviewer — 4.2 (partial)
- Branch/worktree: auth persistence on `feat/auth-persistence`, integrated and route-wired on `main`; independent read-only review.
- Summary: Implemented one-time wallet-signature challenges, normalized wallet ownership association, opaque HTTP-only browser sessions, keyed token/CSRF digests, atomic replay/expiry/revocation and CSRF-conditioned renewal, strict bounded auth routes, stable errors, origin enforcement, logout, safe public projections, and shared PostgreSQL rate limits with per-subject and global ceilings. The independent review's process-local rate-limit HIGH and origin/bootstrap/internal-ID findings were remediated before commit.
- Files changed: `packages/db` auth schema/migrations/repositories/rate limiting/tests; `apps/web` auth service, route handlers, startup validation, runtime adapters, and tests; environment/API/security documentation; dependency overrides, a contention-safe evidence test timeout, lockfile, manifest, and tracker.
- Verification commands: DB build/typecheck/test and migration freshness; web test/typecheck/production build; root typecheck/test/build/lint/format; frozen install; high-threshold production audit; history secret scan; `git diff --check`; independent adversarial review and remediation review.
- Results: DB passed 33/34 with only the explicitly guarded real-PostgreSQL test skipped; web passed 17/17 after remediation; all four auth routes compile as dynamic Node routes, and the production pre-start command exits nonzero before Next launches when auth or database configuration is invalid. Root test/build passed after a heavily contended runner-test retry; frozen install passed; production audit reports no known vulnerabilities after pinning patched `ws` 8.21.1 and PostCSS 8.5.19; history secret scan passed. Exact multi-instance database concurrency still awaits the guarded PostgreSQL run.
- Security/privacy notes: Nonces, session tokens, CSRF tokens, and rate-limit subjects persist only as digests. Wrong CSRF cannot extend idle lifetime. API responses omit user/session database UUIDs. PostgreSQL fixed-window upserts enforce limits across instances and opportunistically remove bounded expired batches. Every login issues fresh tokens; periodic active-session rotation remains an accepted documented MVP risk under 12-hour absolute/one-hour idle expiry.
- Remaining risks/blockers: A disposable PostgreSQL service is still unavailable, so migrations and concurrency have not executed against a real server. Project/member authorization matrix and public field-allowlist coverage remain incomplete child items in 4.2. Runtime deployment configuration and live wallet-browser exercise remain later integration/deployment gates.
- Commit: DB persistence `ee2d0b1`, CSRF hardening `96709d8`, durable rate limiting `1eb8f1f`, web integration `0a33b53985a6512b59a7ae47ac0e8b38e6d4b9dd`.

## 2026-07-17 13:00 IST — Database engineer + Codex/integrator + independent security reviewer — 4.2 project authorization
- Branch/worktree: DB read model on `feat/project-auth-read-model`, integrated and service-wired on `main`; independent read-only review.
- Summary: Added a minimal project-access read model and server authorization boundary with explicit owner/member roles. A single joined query binds the authenticated user to the requested project, returns no private project fields, makes missing/nonmember/cross-project reads indistinguishable, and fails closed if the owner column and membership role disagree. The web boundary authenticates before lookup, enforces the persisted 26-character project ID, validates the required role at runtime, and rejects mismatched adapter results.
- Files changed: `packages/db/src/repository.ts`, DB unit/guarded integration tests, `apps/web/src/server/project-authorization*`, auth runtime integration, manifest, and tracker.
- Verification commands: DB build/typecheck/test; web test/typecheck; root lint/boundaries; `git diff --check`; independent role-confusion and existence-leakage review.
- Results: DB passed 36/37 with the guarded real-PostgreSQL test skipped; web passed 21/21. Owner, member, member-as-owner denial, unauthenticated access, nonmember, cross-project, missing/deleted project, malformed ID, unknown runtime role, inconsistent ownership, and mismatched adapter results are covered. The reviewer’s unknown-role downgrade finding was reproduced, fixed, and re-tested.
- Security/privacy notes: Unauthorized and nonexistent projects share `PROJECT_NOT_FOUND`; only an authenticated member can receive `AUTH_FORBIDDEN` when attempting an owner-only operation. The read model returns only public ID and role, never internal UUIDs or repository metadata.
- Remaining risks/blockers: The public-endpoint allowlist child item remains open until the receipt API is implemented. Real PostgreSQL authorization and cascade behavior remain guarded by the unavailable disposable database.
- Commit: DB read model `4a845aa`; aligned web/service integration `8af4f7089a92f42ebc138ea6a8ffc8d20f777d27`.

## 2026-07-17 13:25 IST — Database engineer + Codex/integrator + independent security reviewer — 4.3
- Branch/worktree: persistence on `feat/cli-token-persistence`, integrated and API-wired on `main`; independent read-only adversarial review.
- Summary: Implemented owner-managed, project-scoped CLI credentials with canonical secret validation, copy-once responses, HMAC-SHA-256 digest-only persistence, atomic project-bound authentication/last-use, idempotent audited revocation, exact retry-safe credential derivation, strict origin/CSRF/body/idempotency validation, stable errors, credential-header redaction, and distinct durable PostgreSQL quotas for bearer authentication, creation, and emergency revocation.
- Files changed: `packages/db` CLI-token repository/tests from the specialist integration; `apps/web` credential codec/authenticator, owner handlers, runtime adapters, dynamic API routes, tests, and project-authorization reuse; `.env.example`, `API_AND_SCHEMA.md`, dependency overrides/lockfile, manifest, and tracker.
- Verification commands: DB test/typecheck/build; web test/typecheck/production build; root format/lint/boundaries/typecheck/test/build; dependency audit; history secret scan; `git diff --check`; independent retry, rate-limit, derivation-domain, and plaintext-persistence probes.
- Results: Web passed 33/33; DB passed 42 deterministic tests with only the guarded real-PostgreSQL migration test skipped; all root quality/test/build gates passed; production build exposes both CLI-token routes as dynamic Node routes; dependency audit reports no known vulnerabilities after the narrow patched `esbuild` override. Independent re-review reproduced the initial non-idempotent retry and missing management-limit findings, verified both remediations, and reports no remaining critical/high/medium finding.
- Security/privacy notes: The independent CLI secret is canonical unpadded base64url with at least 32 decoded bytes. Credential material, public IDs, stored digests, and rate keys use separate HMAC domains. Plaintext never enters repository, idempotency, audit, or safe-header data. Global rate limits execute before attacker-controlled subject keys; owner/project subject limits execute only after authorization. Creation and revocation quotas are separated so creation traffic cannot consume emergency-revocation capacity.
- Remaining risks/blockers: Actual PostgreSQL migration/concurrency execution remains blocked by the unavailable disposable database. Deployment should add edge/IP abuse controls; fixed-window `429` responses do not yet include `Retry-After`. Token-management UI remains task 6.3. Public endpoint field allowlisting remains task 4.2/4.7.
- Commit: API/security integration `554b263d39dfee94827b0c2da2a19105a71090bc`; DB persistence integration `2171c40`.

## 2026-07-17 14:19 IST — Database engineer + Codex/integrator + independent security reviewer — 4.4
- Branch/worktree: DB implementation/remediation on `feat/project-policy-repository`, integrated and route-wired on `main`; independent read-only falsification and remediation review.
- Summary: Delivered membership-scoped project create/list/detail/update/archive and immutable policy upload/history/detail/activation APIs. Strict shared schemas canonicalize GitHub repository identity and Git branch metadata; server-side duplicate-safe policy parsing computes RFC 8785/Keccak commitments and never trusts client hashes. Owner writes enforce origin, CSRF, durable global/subject quotas, HMAC-derived retry-stable public IDs, typed idempotency, transactional audits, archived-state rules, and repository immutability after the first task. Public DTOs omit internal IDs and raw YAML.
- Files changed: `packages/shared` project/error schemas and tests; `packages/evidence` web-consumer ProcessEnv compatibility; `packages/db` project/policy repository, idempotency response snapshots, timestamp/source-path constraints, migrations, and deterministic/guarded tests; `apps/web` input schemas, handlers, DB adapter, rate-limit adapter, routes, and tests; API/environment documentation, CLI normalization regression, manifest, and tracker.
- Verification commands: shared/evidence/DB/web focused build/typecheck/tests; DB migration freshness generation; web production build; root format/lint/boundaries/typecheck/test/build; dependency audit; history secret scan; `git diff --check`; two independent adversarial review rounds with temporal retry, sub-millisecond pagination, branch, path, authorization, data-leak, and rate-limit probes.
- Results: Shared passed 16/16, evidence 36/36, DB 60/60 deterministic tests with one guarded live-PostgreSQL test skipped, web 47/47, and CLI 22/22 after updating the expected canonical GitHub URL. All project/policy routes compile as dynamic Node routes. The first review found a HIGH temporal idempotency defect plus pagination/branch issues; response snapshots, SQL keysets, millisecond timestamp precision, and stricter validation were added. Re-review reproduced each correction and reports no remaining critical/high/medium finding. Dependency audit reports no known vulnerabilities.
- Security/privacy notes: Idempotency rows store strict allowlisted safe response snapshots/status, never internal UUIDs, raw YAML, canonical policy payloads, or credentials; policy replay rehydrates canonical JSON only from the immutable project-bound policy row after owner authorization. SQL pagination is bounded to 100 and uses `(created_at, public_id)` keysets. Create/update/policy/activation quotas use separate HMACed durable scopes. Private repositories and canonical policies remain member-only.
- Remaining risks/blockers: The guarded migration/concurrency/temporal PostgreSQL test could not run because no Docker/PostgreSQL daemon or `TEST_DATABASE_URL` is available. The exported legacy `DoneBondRepository.createProject` has no production caller and lacks response-snapshot semantics; production web code uses only `DrizzleProjectPolicyRepository`, and the legacy method should be delegated or removed before any future service adopts it. Fixed-window `429` responses still omit `Retry-After` and deployment should add edge/IP controls.
- Commit: API integration `619955ecd9630e7f370caaa40bf3f2a1e779a55e`; DB foundation `4a29bb2`, response-snapshot/keyset remediation `da3b61e`.

## 2026-07-18 14:40 IST — OpenCode/coordinator — 4.5 (complete)
- Branch/worktree: `main`
- Summary: Completed the task lifecycle API vertical slice. Implemented `task-runtime.ts` dispatcher wiring `DrizzleTaskRepository` + `MonadTaskReceiptProvider` to `createTaskHandlers`. Added reconciliation store adapter methods (`getTaskChainReconciliationContext`, `markTransactionUnknown`, `markTransactionReverted`, `confirmTaskCreatedFromReconciliation`) to `DrizzleTaskRepository`. Added route handlers for task create, chain intent, wallet outcome, replacement, reconciliation, and read. Added input validation with contract-bound field normalization. Added receipt provider for Monad RPC that preserves authoritative receipt and log fields. All 69 web tests pass, 66/67 DB tests pass (1 skipped PostgreSQL), 22 CLI tests, 36 evidence, 16 shared.
- Files changed: `apps/web/src/server/task-runtime.ts` (new), `apps/web/src/server/task-handlers.ts` (new), `apps/web/src/server/task-handlers.test.ts` (new), `apps/web/src/server/task-input.ts` (new), `apps/web/src/server/task-input.test.ts` (new), `apps/web/src/server/task-receipt-provider.ts` (new), `apps/web/src/server/task-receipt-provider.test.ts` (new), `apps/web/src/server/task-reconciliation.ts` (new), `apps/web/src/server/task-reconciliation.test.ts` (new), `packages/db/src/task-chain-repository.ts` (modified), `packages/db/test/task-chain-repository.test.mjs` (modified), `packages/shared/src/domain.ts` (modified), `packages/shared/src/errors.ts` (modified), route files under `apps/web/src/app/api/v1/projects/[projectId]/tasks/`, `apps/web/src/app/api/v1/tasks/[taskId]/`, `apps/web/src/app/api/v1/chain/reconcile/[transactionId]/`, plus minor fixes to `project-policy-runtime.ts`, `auth-runtime.ts`, `project-write-rate-limiter.test.ts`, `project-policy-handlers.ts`.
- Verification commands: `pnpm typecheck` (6/6), `pnpm lint` (0 errors, boundaries OK), `pnpm format:check` (all clean), `pnpm test` (11/11 suites, shared 16, evidence 36, db 66/67, cli 22, web 69).
- Results: All gates pass. Task API routes compile as dynamic Node routes with production build: `/api/v1/projects/[projectId]/tasks`, `/api/v1/tasks/[taskId]`, `/api/v1/tasks/[taskId]/chain-intent`, `/api/v1/tasks/[taskId]/chain-transactions`, `/api/v1/chain/reconcile/[transactionId]`.
- Security/privacy notes: Task creation validates project ownership, policy binding, supported networks, and canonical hashes server-side. Chain intent persists before wallet use and is replay-safe. Wallet outcome rejects browser-confirmed states. Reconciliation hides unknown transactions behind auth boundary. Receipt provider never exposes RPC credentials.
- Remaining risks/blockers: Push blocked by SSH key issue. Real PostgreSQL and Monad RPC not available for integration tests. Contract not deployed. UI work (Milestone 6) not started.
- Commit: `94d29bf4bf5e5c76b9b2301151cbaee842d9bbbb`

## 2026-07-18 — Claude Code/coordinator — 4.6 (complete)
- Branch/worktree: `main`
- Summary: Completed the Evidence API left in progress at a checkpoint. Added `EVIDENCE_NOT_FOUND`/`EVIDENCE_UPLOAD_CONFLICT` error codes. Added `DoneBondRepository.findTaskBinding` (resolves a task's project/policy UUIDs, project public ID, and current `taskHash`/`policyHash` from its public ID) and fixed a pre-existing type error plus a pagination bug (`nextCursor` was always `null` on a supplied cursor) in the in-progress `listEvidence` query. Rewrote the `evidence-runtime.ts` store adapter to properly build `EvidencePersistenceInput` from resolved UUIDs instead of empty-string placeholders, and to convert ISO check timestamps to `Date` before insert. Added server-side defense-in-depth the checkpoint's draft omitted: submitted `task.taskHash`/`policy.policyHash` are compared against the current DB record (`EVIDENCE_HASH_MISMATCH` on drift) and check stdout/stderr previews are re-scanned for residual secrets (`EVIDENCE_RESIDUAL_SECRET`) before persistence, reusing `@donebond/evidence`'s `findResidualSecrets`. Fixed the CLI token principal to carry the token's internal UUID (`tokenId`) so the store can populate `submittedByTokenId` correctly instead of the public ID. Fixed `getEvidence`'s 404 body to use the standard `HttpError`/`ApiErrorSchema` envelope instead of a hand-built object missing `correlationId`/`retryable`. Created the three route files: `POST /api/v1/projects/[projectId]/evidence`, `GET /api/v1/projects/[projectId]/tasks/[taskId]/evidence` (nested under project, not the flat path sketched mid-session, because CLI-token auth must know the project before authenticating), `GET /api/v1/evidence/[evidenceId]`.
- Files changed: `packages/shared/src/errors.ts`, `packages/db/src/repository.ts`, `packages/db/test/repository.test.mjs` (fake DB helper extended with `orderBy`/bare-`then` support, 3 new tests), `apps/web/src/server/cli-token.ts`, `apps/web/src/server/cli-token.test.ts`, `apps/web/src/server/evidence-handlers.ts`, `apps/web/src/server/evidence-handlers.test.ts` (new, 10 tests), `apps/web/src/server/evidence-runtime.ts`, `apps/web/src/server/evidence-runtime.test.ts` (new, 3 tests), three new route files under `apps/web/src/app/api/v1/`.
- Verification commands: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:contracts && pnpm build`.
- Results: All pass. shared 16/16, db 69/70 (1 pre-existing guarded Postgres integration test skipped), cli 22/22, web 82/82, contracts 32/32. Production build compiles all three new evidence routes as dynamic Node routes.
- Security/privacy notes: Evidence submission now fails closed if the client-declared task/policy commitments don't match the authoritative DB row (prevents uploading evidence against a stale or wrong policy/task version), and if redacted check output still contains a high-confidence secret pattern after CLI-side redaction. `submittedByTokenId` stores the token's internal UUID, never the public ID. Idempotency conflicts and unknown evidence both fail closed with `409`/`404` through the shared `HttpError`/`ApiErrorSchema` envelope.
- Remaining risks/blockers: `pnpm test:e2e` was not run — requires `NEXT_PUBLIC_APP_URL`/`AUTH_SECRET` local env configuration that has never existed in this repo (only `.env.example`); unrelated to this change. Returning unsigned receipt call parameters for passing evidence is deferred to 4.7 (needs chain calldata wiring analogous to task chain-intent). Push blocked by the same SSH key issue noted in 4.5. Real PostgreSQL/Monad RPC integration still unavailable.
- Commit: `423ace4329c013f024e089109c2523924380dea7`.

## 2026-07-18 — Claude Code/coordinator (frontend-engineer subagent) — 6.1 (complete)
- Branch/worktree: `main` (subagent worked directly in the primary worktree, scoped to `packages/ui` and `apps/web/src/app/**` only; a separate isolated-worktree agent was concurrently building 4.7 in `.claude/worktrees/agent-a9fb3baf264e58c3b`, no file overlap).
- Summary: Built the design system in `packages/ui` (previously an empty stub) — a token layer (`tokens.css`) extending the existing dark palette and Geist Sans/Mono type stack rather than replacing it, and 14 accessible component primitives: Text/Heading/Stack/Code (typography+layout), Button/Input/Textarea/Field (forms), Dialog/Toast/Tabs (overlay/navigation, each implementing a real WAI-ARIA APG pattern), StatusBadge/HashDisplay/CheckResult/TransactionState (status/domain display). `CheckResult`/`TransactionState` derive their status prop types directly from `CheckResult["status"]`/`ChainTransaction["status"]` in `@donebond/shared` so they can't drift from the frozen schemas. Interactive/keyboard logic (focus trap, tab navigation, hash truncation, status-to-visual-treatment mapping) was extracted into pure functions and unit-tested with `node:test`, since this repo has no jsdom/RTL and untested accessibility logic isn't verified accessibility. `apps/web/src/app/page.tsx` now renders several primitives as a real integration proof point (full landing redesign is milestone 6.2).
- Files changed: `packages/ui/package.json`, `packages/ui/tsconfig.json` (added `jsx`/DOM lib/`Bundler` resolution — required because `@donebond/ui`'s `exports` points at `.tsx` source directly and Turbopack resolves relative imports against it, unlike `tsc`'s `NodeNext` convention), `packages/ui/src/index.ts` (barrel, marked `"use client"` once at the barrel since several primitives are inherently interactive), `packages/ui/src/tokens.css` (new), `packages/ui/src/css-modules.d.ts` (new), `packages/ui/src/lib/{focus-trap,hash,status-treatment,tabs-navigation}.ts` + matching `.test.ts` files (new, 28 tests), 14 component folders under `packages/ui/src/components/` (new), `apps/web/src/app/page.tsx`, `apps/web/src/app/styles.css` (now imports `@donebond/ui/tokens.css` and consumes `--db-*` custom properties instead of hardcoded literals), `pnpm-lock.yaml` (hand-added exactly 2 new devDependency entries — `react`/`@types/react` under `packages/ui` — after a plain `pnpm install` reformatted the whole file with no dependency-graph difference beyond those two lines; verified with `pnpm install --frozen-lockfile`).
- Verification commands: `pnpm --filter @donebond/ui typecheck/build/test`, `pnpm --filter @donebond/web typecheck/build`, `pnpm format:check`, `pnpm lint`, full `pnpm test`. All re-run independently by the coordinating session, not just taken from the subagent's report.
- Results: `@donebond/ui` typecheck/build pass; `@donebond/ui` test 28/28 pass; `@donebond/web` typecheck/build pass, production build renders `/` through the workspace package (confirmed hashed CSS Module classnames in the built output); `pnpm format:check`/`pnpm lint` clean for every file in scope; full `pnpm test` 12/12 workspace tasks successful (shared 16, db 69/70 with 1 pre-existing skip, cli 22, web 82, ui 28 — no regressions elsewhere).
- Security/privacy notes: No new runtime dependency beyond `react`/`@types/react` (already used elsewhere in the workspace at the same pinned versions) — no CSS framework, no component library, no DOM test runner added. Workspace boundary check confirms `@donebond/ui` still depends only on `@donebond/shared` internally.
- Remaining risks/blockers: Milestones 6.2–6.7 (the actual product screens) still need to consume these primitives — only the landing page has a minimal integration touchpoint so far. No jsdom/RTL exists in this repo, so component rendering itself (as opposed to the pure logic it calls) is not exercised by an automated DOM test; a future milestone should decide whether to add one. Push blocked by the same SSH key issue noted in 4.5/4.6.
- Commit: `6d8ce963f6cff2d0540a6e5ed698c7b5f7c40c33`.
