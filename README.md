# DoneBond Build Kit

**DoneBond** is a Git-native proof-of-done and outcome-settlement layer for AI coding agents.

## Hackathon status

DoneBond is a new solo project for the [2026 Spark hackathon](https://buildanything.so/hackathons/spark?tab=overview). The official
submission window closes on **July 19, 2026 at 11:59 PM UTC**. Until a release
commit is identified, this repository is under active construction and should
not be treated as a deployed or production-ready service.

Release gates are tracked in `task.md`, including a public repository, hosted
application, verified Monad contract, real end-to-end receipt and settlement,
clean-clone verification, and a public demo shorter than three minutes.

A developer creates a task with explicit acceptance criteria and deterministic checks. Codex, Claude Code, OpenCode, or another agent implements the task. The DoneBond CLI executes the approved checks locally, captures the exact Git state, redacts sensitive output, and creates a canonical evidence bundle. The application anchors hashes of the task, policy, commit, and evidence on Monad. An optional native-MON bounty is released only after the task owner approves the verified result.

## Why this idea can win

- It solves a problem experienced by nearly every developer using autonomous coding agents: an agent saying “done” is not proof that the work is correct.
- It is immediately usable through a CLI and Git workflow rather than requiring teams to replace their editor or agent.
- Blockchain has a meaningful job: tamper-evident receipts, neutral task state, and outcome-based settlement between parties that may not trust each other.
- The demo is easy to understand: a failed check blocks a receipt; a real fix produces a passing receipt; the receipt is anchored and the bounty becomes claimable.
- It has a SaaS path for founders, engineering teams, agencies, OSS maintainers, bounty platforms, and AI-agent marketplaces.

## Primary MVP loop

1. Create a project and verification policy.
2. Create a task, optionally funding it with MON.
3. Give the task to any coding agent.
4. Run `donebond verify` in the repository.
5. Upload the evidence bundle.
6. Submit its hashes to the Monad contract.
7. Approve the verified result and withdraw the bounty.
8. Share a public proof page.

## Recommended implementation stack

- Monorepo: pnpm + Turborepo
- Web: Next.js, TypeScript, Tailwind, accessible component primitives
- API: Next.js route handlers or a small Node service
- Database: PostgreSQL + Drizzle ORM
- Contracts: Solidity + Foundry + OpenZeppelin
- Web3: viem + wagmi; Reown AppKit or another compatible wallet connector
- CLI: TypeScript, Commander, execa, Zod
- Tests: Vitest, Foundry, Playwright
- Deployment: Vercel for web/API, managed PostgreSQL, Monad Testnet first

## Read first

1. `00_IDEA_AND_STARTUP_STRATEGY.md`
2. `PRD.md`
3. `ARCHITECTURE.md`
4. `SECURITY.md`
5. `VERIFICATION.md`
6. `GIT_IDENTITY.md`
7. `AGENTS.md`
8. `task.md`
9. The agent-specific guide: `CODEX.md`, `CLAUDE.md`, or `OPENCODE.md`
10. `STARTING_PROMPT.md`

## Non-negotiable constraints

- Create a fresh repository and fresh history for the hackathon.
- The working repository must use the local Git identity `Vedant817 <vedantmahajan271@gmail.com>`.
- Push only through the personal SSH host alias, normally `github-personal`.
- Never use the work GitHub account, a generic `git@github.com` remote, global Git identity changes, or copied pre-hackathon source code.
- Never hardcode demo results or let AI prose override failed deterministic checks.
- Never store source code, logs, secrets, or personal data onchain; store hashes and minimal public metadata.
- Treat a locally passing result as provisional until API validation and chain confirmation succeed.

## Definition of a successful MVP

A new evaluator can clone the public repository, follow the README, deploy or use the hosted application, create a task, run a deliberately failing verification, make a real code change, generate a passing bundle, anchor it on Monad, see the transaction in an explorer, approve a funded task, and withdraw the reward.
