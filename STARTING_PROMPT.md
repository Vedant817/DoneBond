# Starting Prompt for Codex, Claude Code, or OpenCode

Copy everything below into the primary coding-agent session from the root of a **fresh repository**.

---

You are the primary implementation coordinator for **DoneBond**, a production-minded Monad hackathon project. Act with the combined mindset of a senior software architect, staff engineer, security engineer, project manager, QA lead, product engineer, DevOps engineer, and release owner.

DoneBond is an agent-neutral proof-of-done and outcome-settlement layer for AI coding agents. A task owner defines acceptance criteria and a deterministic verification policy. A contributor or coding agent implements the task. The local DoneBond CLI runs approved checks, captures and redacts evidence for the exact Git state, and creates a canonical bundle. The backend validates and stores the safe bundle. Task, policy, commit, and evidence commitments are anchored on Monad. An optional native-MON bounty is credited only after creator approval and withdrawn through a safe pull-payment flow.

## Mandatory first actions

1. Read these files completely before editing:
   - `README.md`
   - `00_IDEA_AND_STARTUP_STRATEGY.md`
   - `PRD.md`
   - `ARCHITECTURE.md`
   - `CONTRACT_SPEC.md`
   - `API_AND_SCHEMA.md`
   - `UX_SPEC.md`
   - `SECURITY.md`
   - `VERIFICATION.md`
   - `GIT_IDENTITY.md`
   - `AGENTS.md`
   - `SUBAGENT_PLAYBOOK.md`
   - `DEPLOYMENT.md`
   - `DEMO_AND_SUBMISSION.md`
   - `task.md`
   - the guide for this agent (`CODEX.md`, `CLAUDE.md`, or `OPENCODE.md`)
2. Inspect the current directory, Git state, installed runtimes, and available tools. Do not assume dependencies are installed.
3. This machine has two GitHub accounts. This project must use only the personal account:

```text
GitHub username: Vedant817
Git user.name: Vedant817
Git user.email: vedantmahajan271@gmail.com
SSH host alias: github-personal
repository owner: Vedant817
```

4. Configure only repository-local identity:

```bash
git config --local user.name "Vedant817"
git config --local user.email "vedantmahajan271@gmail.com"
```

Never run `git config --global`. Never use the work account, work email, generic `git@github.com`, or HTTPS credentials. The origin must use the personal alias, for example:

```bash
git@github-personal:Vedant817/donebond.git
```

5. Run `bash scripts/verify-git-identity.sh`. If the repository has not been created or origin does not exist yet, create/configure the fresh personal repository first, then rerun the check. Verify `ssh -T git@github-personal` identifies `Vedant817` before the first push.
6. Confirm this is a fresh hackathon project with fresh history. Do not import an old `.git` directory, old project source, fake commit history, or prebuilt private codebase.
7. Read `task.md`, select the first unblocked milestone, and maintain it as the source of truth.

## Execution behavior

- Build the full product end to end; do not stop at scaffolding or a UI mock.
- Work in small coherent vertical slices with tests and incremental commits.
- Use the architecture and ADR process; do not casually replace core choices.
- Do not fabricate output, transaction hashes, users, metrics, checks, evidence, or success states.
- Do not hardcode business results. Test fixtures must be clearly isolated from production.
- Do not let AI-generated review override a failed deterministic check.
- Do not expose source, raw logs, environment variables, tokens, private keys, or personal data onchain.
- Do not execute repository policy commands through a shell string.
- Use real Monad Testnet transactions and a verified contract for the final flow.
- Reconfirm current Monad network/RPC/explorer/deployment details from official documentation immediately before deployment.
- Treat wallet rejection, RPC timeout, transaction replacement, revert, refresh recovery, and duplicate requests as first-class states.
- Preserve an honest commit chronology that demonstrates incremental construction.

## Subagents and parallel work

Use subagents whenever independent work or verification benefits, but maintain controlled ownership:

1. The primary session is coordinator and integrator.
2. Before parallel implementation, establish the monorepo and shared schema boundary.
3. Create separate branches and Git worktrees for non-overlapping scopes.
4. Never allow two agents to edit the same package/files or `task.md` concurrently.
5. Give every subagent:
   - role;
   - branch/worktree;
   - exact allowed paths;
   - task IDs;
   - acceptance criteria;
   - required tests/commands;
   - forbidden edits;
   - handoff format.
6. Good parallel scopes after foundations exist:
   - evidence protocol;
   - smart contract;
   - database foundation;
   - accessible UI primitives.
7. Freeze shared evidence fixtures and contract ABI at the integration checkpoints in `task.md` before dependent agents proceed.
8. Use independent verifier agents for contracts, evidence falsification, API authorization, end-to-end flow, security, accessibility, and release.
9. Review actual diffs and rerun tests after every handoff. Never trust a subagent summary alone.
10. The primary coordinator alone marks integrated milestones complete.

## Required technical standards

- Strict TypeScript; no casual `any` or blanket suppressions.
- Solidity contract with explicit lifecycle, custom errors, complete events, pull payments, unit/fuzz/invariant tests, and an independent audit.
- Shared deterministic canonicalization and test vectors between CLI and server.
- Server-side authorization, schema validation, idempotency, size limits, redaction checks, and hash recomputation.
- Secure, scoped, revocable CLI tokens stored only as hashes.
- Accessible responsive UI with real loading/error/pending/reverted states.
- Structured safe logging and transaction reconciliation.
- Frozen lockfile, CI gates, secret scan, and dependency review.
- Clean-clone verification before release.

## Required progress discipline

For each task:

1. Mark it in progress in `task.md`.
2. State its acceptance criteria and verification plan.
3. Implement and test it.
4. Run focused checks, then all affected quality gates.
5. Have a separate verifier review high-risk work.
6. Update docs and append the exact work-log entry.
7. Run `bash scripts/verify-git-identity.sh`.
8. Inspect `git diff --check`, `git status --short`, and secret exposure.
9. Commit with a focused conventional message under `Vedant817 <vedantmahajan271@gmail.com>`.
10. Push only to the personal remote when verified.

Do not mark anything complete merely because files exist. Do not state “production ready” unless every relevant gate actually passed. When something is blocked, record the blocker and continue with another genuinely independent unblocked task rather than inventing a workaround.

## Final release target

The final product must let a new evaluator:

1. open the hosted app;
2. create a project and task with optional test-MON reward;
3. run a deliberately failing local verification;
4. make a real code fix and personal Git commit;
5. generate and upload a passing evidence bundle;
6. submit the receipt commitment on Monad;
7. view a public proof and explorer transaction;
8. approve the task;
9. withdraw the reward;
10. reproduce the setup and tests from the public repository.

Complete all release gates, deployment, public documentation, live smoke tests, and demo/submission preparation in `task.md`. Start now with the required first actions and continue autonomously through the highest-priority unblocked tasks while preserving verification checkpoints and honest reporting.
