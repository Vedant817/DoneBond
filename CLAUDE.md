# CLAUDE.md

Claude Code must follow `AGENTS.md`, `task.md`, and all repository specifications.

## Claude-specific workflow

1. Use a plan for multi-file or architectural changes.
2. Read the relevant files before editing; do not infer unseen implementations.
3. Keep context focused by delegating independent investigation/review to subagents.
4. Give each subagent explicit allowed paths, acceptance criteria, and required verification.
5. Use separate Git worktrees for concurrent implementation agents.
6. Keep one primary coordinator responsible for integration and final claims.
7. After each handoff, inspect the actual diff and rerun tests rather than trusting the summary.
8. Update `task.md` only after verification.

## Recommended Claude subagents

- `architect-reviewer` — read-only architecture/ADR analysis
- `contract-engineer` — `packages/contracts/**`
- `contract-auditor` — read-only first, adversarial tests on separate branch
- `evidence-engineer` — `packages/evidence/**`
- `backend-engineer` — database/API paths
- `cli-engineer` — `apps/cli/**`
- `frontend-engineer` — `apps/web/**` and approved UI package files
- `qa-verifier` — fixtures/e2e and clean-clone verification
- `security-reviewer` — read-only findings and assigned remediation

Do not ask all subagents to “build the project.” Give narrow non-overlapping ownership.

## Git guard

Before any commit or push, Claude must run:

```bash
bash scripts/verify-git-identity.sh
git log -1 --format='author=%an <%ae>%ncommitter=%cn <%ce>' 2>/dev/null || true
git remote -v
```

Expected identity is `Vedant817 <vedantmahajan271@gmail.com>` and expected personal owner is `Vedant817`. Never modify global Git settings.

## Prohibited shortcuts

- no fabricated screenshots or transaction hashes;
- no bypassing wallet actions with a hidden server key;
- no mock passing evidence in production;
- no weakening tests to satisfy them;
- no unexplained large generated rewrites;
- no storing secrets in Claude project files or command output committed to Git.
