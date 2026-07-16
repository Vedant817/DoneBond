# OPENCODE.md

OpenCode must read and follow `AGENTS.md`, `task.md`, and the relevant technical specification before implementation.

## Workflow

- Use a primary session as project coordinator.
- Spawn narrow specialist sessions only for non-overlapping paths.
- Prefer Git worktrees and named branches for parallel work.
- Require every specialist to return files changed, tests, exact command results, risks, and commit.
- Review and integrate through the coordinator.
- Rerun repository-wide verification after integration.

## Personal Git account rule

All repository commits and pushes must use:

```text
user.name=Vedant817
user.email=vedantmahajan271@gmail.com
remote owner=Vedant817
SSH alias=github-personal (preferred)
```

Run `bash scripts/verify-git-identity.sh` before committing and pushing. Never use or alter the work account/global Git configuration.

## Quality rule

Do not optimize for the appearance of completeness. Implement and test real behavior, preserve failed states, use live Monad transactions, and disclose any limitation that remains.
