# DoneBond Build Kit

**DoneBond** is a Git-native proof-of-done and outcome-settlement layer for AI coding agents.

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

## What is implemented

- Wallet challenge authentication, project/policy/task management, copy-once CLI tokens, and a responsive project UI.
- A strict CLI workflow: `init`, `policy validate`, `task pull`, `verify`, `submit`, and independent `receipt verify`.
- Canonical evidence generation with exact Git-state binding, bounded deterministic checks, secret redaction, and server-side commitment revalidation.
- Monad task escrow, passing-evidence attestations, receipt anchoring, approve/reject/cancel, and pull-payment withdrawal.
- Public proof pages and APIs that expose the canonical safe bundle needed for independent hash verification.
- PostgreSQL migrations, idempotent wallet-transaction registration, confirmation reconciliation, security headers, CI, Foundry tests, and Playwright smoke tests.

## Local development

Prerequisites are Node.js 24.14, pnpm 11.6, PostgreSQL 17, and Foundry 1.7.1. Copy `.env.example` to `.env`, generate the three application secrets as documented there, and configure a local or Monad Testnet registry.

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3100`. The web process validates its auth and verifier configuration before production startup. Use a separate database for integration tests; the guarded database test refuses remote or unconfirmed destructive resets.

## CLI workflow

The workspace build is directly runnable before publication:

```bash
pnpm --filter @donebond/cli build
pnpm donebond --help

# after creating a project and copy-once token in the web app
printf '%s' "$DONEBOND_CLI_TOKEN" | pnpm donebond init \
  --api-url https://your-app.example --project-id <project-id> --token-stdin
pnpm donebond task pull <task-id>
pnpm donebond verify
pnpm donebond submit
pnpm donebond receipt verify <receipt-id> \
  --api-url https://your-app.example --rpc-url https://rpc.testnet.monad.xyz
```

`receipt verify` downloads the public canonical bundle, recomputes the evidence hash, recovers the immutable verifier signature, reads the registry state, and validates the exact `ReceiptSubmitted` event through the independently selected RPC.

## Testnet release

Follow [DEPLOYMENT.md](./DEPLOYMENT.md). A public release requires a dedicated funded deployer, a verifier EOA, a managed PostgreSQL database, the applied migrations, and the deployed registry address/block in the hosting platform's secret store. Never reuse the verifier key as a deployer key.

Run the complete release gate before deployment:

```bash
pnpm verify
TEST_DATABASE_URL=postgresql://... DONEBOND_ALLOW_DATABASE_RESET=test-only-confirmed \
  node --test packages/db/test/postgres.integration.test.mjs
```

## Implementation stack

- Monorepo: pnpm + Turborepo
- Web: Next.js App Router, React, TypeScript, and accessible component primitives
- API: Next.js route handlers or a small Node service
- Database: PostgreSQL (Supabase) + Drizzle ORM
- Contracts: Solidity + Foundry + OpenZeppelin
- Web3: viem with EIP-1193 injected-wallet requests
- CLI: TypeScript with strict local parsing and shell-free process execution
- Tests: Node.js built-in test runner, Foundry, Playwright
- Deployment: Vercel for web/API, Supabase Postgres, Monad Testnet first

## Non-negotiable constraints

- Never hardcode demo results or let AI prose override failed deterministic checks.
- Never store source code, logs, secrets, or personal data onchain; store hashes and minimal public metadata.
- Treat a locally passing result as provisional until API validation and chain confirmation succeed.

## Definition of a successful MVP

A new evaluator can clone the public repository, follow the README, deploy or use the hosted application, create a task, run a deliberately failing verification, make a real code change, generate a passing bundle, anchor it on Monad, see the transaction in an explorer, approve a funded task, and withdraw the reward.
