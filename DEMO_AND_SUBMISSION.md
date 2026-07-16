# Demo and Submission Plan

## Three-minute video structure

### 0:00–0:20 — Problem

“AI coding agents can write quickly, but they are also the ones claiming the work is done. Developers still have to reconstruct what was tested and whether the result matches the task.”

Show a coding-agent completion claim beside a failed DoneBond check.

### 0:20–0:40 — Product and USP

“DoneBond is an agent-neutral proof-of-done layer. It binds acceptance criteria, a verification policy, deterministic check results, and the exact Git commit into a portable receipt. Monad anchors the receipt and can settle an outcome bounty.”

### 0:40–1:10 — Create a real task

- Open project.
- Create “Add rate limiting with tests.”
- Show acceptance criteria and policy summary.
- Assign contributor wallet and add a small test-MON reward.
- Confirm the transaction on Monad Testnet.

### 1:10–1:35 — Failure is real

Run:

```bash
donebond verify --task <id>
```

Show the security/integration test failing and the bundle marked non-passing. Show that receipt submission is unavailable.

### 1:35–2:00 — Fix and prove

Show the small real implementation diff and personal Git commit. Rerun verification. Show required checks pass, the exact commit ID, task/policy/evidence hashes, and successful upload.

### 2:00–2:30 — Anchor and settle

- Submit receipt through wallet.
- Open public proof page.
- Open Monad explorer transaction/verified contract.
- Creator approves.
- Contributor withdraws reward.

### 2:30–2:55 — Startup potential

“Today DoneBond works with any local coding agent. Next it becomes the verification/status layer for GitHub, OSS bounties, agencies, and agent marketplaces—charging teams for private policies, audit history, and settlement.”

### 2:55–3:00 — Close

“Any agent can write the code. DoneBond shows the proof.”

## Recording checklist

- Use a clean browser profile and test wallet.
- Hide notifications and unrelated bookmarks/tabs.
- Never show private keys, seed phrases, tokens, database URLs, or work-account information.
- Use readable zoom and terminal font.
- Keep one coherent flow; avoid a feature montage.
- Use genuine transaction and explorer pages.
- Trim waiting time without implying a fake result.
- Add captions for hashes/status transitions.

## Submission copy skeleton

### Project name

DoneBond

### Tagline

Proof-of-done and outcome settlement for AI coding agents.

### Problem

AI coding agents generate code and also self-report completion. Developers lack a portable, trustworthy record of which acceptance criteria and deterministic checks passed for the exact code being accepted, especially when multiple agents or financially independent contributors are involved.

### Solution

DoneBond lets a task owner define acceptance criteria and a machine-readable policy. Its local CLI independently runs approved checks, captures and redacts evidence, binds it to the Git commit, and creates a canonical receipt. The commitments and approval state are anchored on Monad, where an optional reward can be credited only after the creator accepts the verified result.

### Why onchain

Monad provides neutral, tamper-evident task/receipt commitments and outcome settlement between task owners, contributors, and agent platforms that do not need to share one trusted database. Source code and logs remain offchain; only minimal hashes, lifecycle state, and reward accounting are public.

### Built with

- Monad Testnet
- Solidity and Foundry
- Next.js and TypeScript
- viem/wagmi
- PostgreSQL/Drizzle
- TypeScript CLI
- Playwright/Vitest

Replace this list with the actual final stack.

## Final submission checklist

- Public GitHub repository under `Vedant817`
- Hosted application URL
- Correct Monad network category
- Verified contract address
- Explorer transaction showing the working flow
- Public video under three minutes
- README with local setup, tests, architecture, security, and live links
- Social post link if targeting the viral prize
- No placeholders or stale URLs
- Submission confirmation saved
