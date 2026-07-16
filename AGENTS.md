# AGENTS.md — Repository Operating Guide

This file governs every implementation agent in the DoneBond repository, regardless of whether it is Codex, Claude Code, OpenCode, or another system.

## Prime directive

Build a real, secure, comprehensible product from the specifications. Use `task.md` as the source of truth. Implement one coherent task or dependency-safe task group, verify it, update the tracker, and commit it. Never claim completion without evidence.

## Required starting routine

At the beginning of every implementation session:

1. Read `README.md`, `PRD.md`, `ARCHITECTURE.md`, `SECURITY.md`, `VERIFICATION.md`, `GIT_IDENTITY.md`, and `task.md`.
2. Read the specification relevant to the selected task.
3. Inspect repository state:

```bash
git status --short
git branch --show-current
git config --local user.name
git config --local user.email
git remote -v
```

4. Run:

```bash
bash scripts/verify-git-identity.sh
```

5. Stop before committing or pushing if the identity/remote check fails. Fix only repository-local configuration; never change global Git settings.
6. Select the highest-priority unblocked task from `task.md`.
7. State the acceptance criteria and verification commands before implementation.
8. Inspect existing code and tests before editing.

## Git identity: absolute rule

Every DoneBond commit and push must use:

```text
GitHub account: Vedant817
Git user.name: Vedant817
Git user.email: vedantmahajan271@gmail.com
Preferred SSH host alias: github-personal
Expected repository owner: Vedant817
```

Never use the work GitHub account or work email. Never run `git config --global`. Never silently rewrite a remote to generic `git@github.com` or HTTPS. See `GIT_IDENTITY.md`.

## Fresh-project rule

This hackathon requires a new project. Do not copy previous repository history, reuse an old repository as the base, forge commit dates, squash all work into one unexplained final commit, or paste large blocks of source from earlier personal projects. Libraries and generated scaffolds are allowed when their origin and licenses are legitimate.

## Implementation standard

- No fake APIs, unconditional success paths, placeholder business logic, hardcoded test results, or demo-only bypasses.
- No silent exception swallowing.
- No disabling tests or lowering assertions to make CI pass.
- No unchecked `any`, blanket lint suppressions, or security warnings ignored without written rationale.
- Keep domain logic separate from transport and UI.
- Prefer small, testable modules and explicit state machines.
- Add migrations rather than editing production schema manually.
- Never commit secrets, `.env` values, private keys, wallet mnemonics, CLI tokens, or unredacted evidence.
- Verify current external network/tool details against official sources before deployment.

## Decision hierarchy

When guidance conflicts, follow this order:

1. Security and fund safety
2. Hackathon eligibility and real functionality
3. Explicit product requirements and acceptance criteria
4. Architecture and ADRs
5. `task.md` sequencing
6. Convenience or aesthetic preference

Document material deviations in a new ADR and update affected specifications.

## Task protocol

For each task:

1. Mark it `[-]` in `task.md` and add role/branch if useful.
2. Identify dependencies and files owned by other active agents.
3. Write or update tests before or alongside implementation.
4. Implement the smallest complete vertical slice.
5. Run focused tests while iterating.
6. Run all relevant quality gates before completion.
7. Request independent verification for contract, auth, evidence, settlement, deployment, or release work.
8. Update documentation and `task.md` work log.
9. Inspect diff for accidental secrets or unrelated changes.
10. Commit with a meaningful conventional message.

## Subagent operating model

Use subagents to increase independent scrutiny, not to create uncontrolled concurrent edits.

### Coordinator / primary agent

- owns architecture, task allocation, integration, and final claims;
- creates separate branches/worktrees;
- ensures scopes do not overlap;
- merges/cherry-picks only after verification;
- resolves schema/API boundaries centrally;
- reruns repository-wide gates after integration.

### Specialist roles

- **Architect:** validates boundaries, state machines, ADRs, and task dependencies.
- **Contract engineer:** implements Solidity and Foundry tests.
- **Contract auditor:** independently attacks state transitions, accounting, and reentrancy; does not accept implementer summary as evidence.
- **Evidence engineer:** implements policy, runner, Git collector, redaction, canonicalization, hashing.
- **Backend engineer:** database, auth, APIs, idempotency, reconciliation.
- **CLI engineer:** command UX and local workflow.
- **Frontend engineer:** accessible screens and wallet transaction states.
- **QA engineer:** fixtures, integration, e2e, recovery, regression tests.
- **Security reviewer:** threat-model-based review across code and dependencies.
- **Release verifier:** clean-clone setup, deployment, smoke test, documentation, submission audit.

### Parallel work rules

- One worktree per active implementation agent.
- One owner per file or package at a time.
- Shared schemas/ABI freeze at integration checkpoints.
- Agents may not commit directly to the primary branch unless explicitly designated as integrator.
- Read-only reviewers may inspect all branches but should report findings before editing.
- Never run two agents in the same working directory.
- Do not let multiple agents modify `task.md` concurrently; coordinator integrates tracker updates.

Suggested worktree commands:

```bash
git worktree add ../donebond-contracts -b feat/contracts
git worktree add ../donebond-evidence -b feat/evidence
git worktree add ../donebond-web -b feat/web
git worktree add ../donebond-qa -b test/e2e
```

Before creating them, verify the base branch is committed and all worktrees inherit the correct repository-local Git identity. Explicitly check each worktree before its first commit.

## Handoff format

Every subagent returns:

```text
Scope completed:
Acceptance criteria status:
Files changed:
Tests added/updated:
Commands run and exact outcomes:
Security/privacy considerations:
Known limitations:
Commit hash:
Review requested from:
```

The coordinator must not integrate a handoff that lacks exact verification outcomes.

## Verification authority

- Deterministic tests and command results outrank agent narratives.
- Contract/event state outranks database/UI assumptions about confirmed transactions.
- Server-recomputed commitments outrank client-provided commitments.
- A verifier must attempt to falsify the result.
- “Works on my machine” is insufficient; use a clean clone or reproducible environment before release.

## Commit protocol

Use focused commits such as:

```text
feat(evidence): add canonical bundle hashing
feat(contracts): implement pull-payment settlement
test(contracts): add solvency invariants
fix(api): reject conflicting evidence replay
docs: add testnet deployment runbook
```

Before each commit:

```bash
bash scripts/verify-git-identity.sh
git diff --check
git status --short
```

Before push:

```bash
git log -1 --format='author=%an <%ae>%ncommitter=%cn <%ce>'
git remote get-url origin
```

## End-of-session routine

1. Run the relevant gates.
2. Update `task.md` and append a work-log entry.
3. Record blockers honestly.
4. Confirm no secrets/untracked required files.
5. Commit using the personal identity.
6. Push only through the personal remote when the branch is ready.
7. Provide a concise handoff with exact commands and results.
