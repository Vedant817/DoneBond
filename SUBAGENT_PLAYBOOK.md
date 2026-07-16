# Subagent Playbook

## Purpose

Use parallel agents for independent packages and adversarial review while preserving one coherent architecture and Git history.

## Wave plan

### Wave 0 — design preflight

Run in parallel, read-only:

- Architect reviews PRD, architecture, task dependencies, and data/state boundaries.
- Security reviewer builds a threat model and identifies release-blocking risks.
- Product reviewer tests whether the demo tells one clear personal-problem story.

Coordinator resolves contradictions before scaffolding.

### Wave 1 — independent foundations

After monorepo and shared types exist:

- Evidence engineer: policy schema, runner, redaction, Git collector, canonicalization.
- Contract engineer: contract and Foundry tests.
- Database engineer: schema/migrations/repository interfaces using frozen shared types.
- Design-system engineer: accessible primitives only, without inventing API contracts.

### Wave 2 — integration surfaces

After evidence fixtures and ABI freeze:

- Backend engineer: evidence/task APIs, auth, idempotency, reconciliation.
- CLI engineer: commands against frozen evidence/API contracts.
- Frontend engineer: product screens against typed API and ABI.
- Contract auditor: independent review of merged contract branch.

### Wave 3 — adversarial verification

- QA engineer builds failure-to-pass e2e.
- Security reviewer attacks auth, redaction, command safety, and settlement.
- Reliability reviewer tests wallet rejection, RPC timeout, retry, duplicate calls, and refresh recovery.
- Accessibility reviewer tests keyboard/mobile/status semantics.

### Wave 4 — release

- Release verifier starts from a clean clone.
- Documentation reviewer follows README literally.
- Judge simulator checks eligibility, no placeholders, public links, commit history, and three-minute story.

## Scope allocation template

```text
Role:
Branch/worktree:
Allowed paths:
Read-only dependencies:
Task IDs:
Acceptance criteria:
Required commands:
Forbidden edits:
Handoff recipient:
```

## Review prompts

### Contract auditor

> Ignore the implementer’s explanation. Derive the lifecycle and accounting model directly from the specification and code. Attempt unauthorized transitions, duplicate credit, reentrancy, deadline edge cases, reward truncation, forced ETH/MON balance effects, and withdrawal failure. Return findings by severity with reproduction tests. Do not modify code until the coordinator assigns remediation.

### Evidence falsifier

> Treat the evidence bundle as hostile input. Attempt to create a passing bundle with a failed or omitted required check, altered task/policy/commit, dirty repository, truncated secret, duplicate check key, nondeterministic ordering, or replayed upload. Add regression tests for every successful attack.

### API security reviewer

> Build and execute an authorization matrix. Attempt IDOR across projects/tasks/evidence, CSRF on browser mutations, replay/conflicting idempotency keys, token leakage, oversized payloads, unsafe public fields, and transaction-state spoofing. Do not accept client ownership or pass/fail fields.

### UX verifier

> Complete the golden flow using only visible UI and documented CLI commands. Check mobile width, keyboard operation, wallet rejection, pending/reverted/unknown transactions, long hashes, failed checks, and empty states. Record steps and screenshots for every defect.

### Release verifier

> Clone into an empty directory with no cached dependencies. Follow the README exactly. Run every quality gate, verify Git identity documentation, inspect for secrets/placeholders, complete the live testnet flow, and compare public proof hashes with chain events. Report anything that prevents a judge from reproducing the claim.

## Conflict prevention

- The coordinator owns shared schemas and task tracker integration.
- Any change to evidence schema, API contract, database schema, or ABI requires a short proposal before implementation.
- Agent branches rebase/merge from an integration branch at checkpoints, not continuously.
- Prefer cherry-picking focused commits over merging noisy branch history.
- Resolve semantic conflicts through specs/ADRs, not by choosing whichever code compiles.

## Parallelism limit

Use at most three implementation agents concurrently unless all scopes are fully independent and the coordinator can still review every handoff. More parallelism is not useful when it increases integration risk.

## Completion rule

A subagent can finish a scope, but only the coordinator can mark the milestone complete after integrated verification.
