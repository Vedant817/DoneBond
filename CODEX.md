# CODEX.md

Codex must treat `AGENTS.md` and `task.md` as binding.

## Codex operating pattern

- Inspect before editing.
- Choose one coherent task group.
- State acceptance criteria and tests.
- Use subagents/worktrees for independent packages or verification.
- Keep implementation and verifier roles separate for high-risk code.
- Execute the required commands directly and report exact outcomes.
- Update documentation/tracker in the same verified change.
- Commit incrementally with the personal Git identity.

## Parallel execution

The primary Codex session is the coordinator. It may delegate:

- contract implementation;
- evidence protocol;
- database/API foundation;
- UI primitives;
- adversarial tests and reviews.

Never allow two agents to edit the same package or `task.md` concurrently. Freeze shared schemas and ABI at the checkpoints in `task.md`.

## Required Git check

```bash
bash scripts/verify-git-identity.sh
```

Expected:

```text
Vedant817
vedantmahajan271@gmail.com
personal remote owned by Vedant817, preferably using github-personal
```

Do not use the work account and do not run `git config --global`.

## Verification standard

Codex summaries are not evidence. A task is complete only after the actual commands pass, relevant failure paths are tested, diff is reviewed, and a separate verifier checks high-risk work.
