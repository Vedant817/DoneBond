# DoneBond: Idea and Startup Strategy

## One-line pitch

DoneBond makes AI coding agents prove that work is complete before a human accepts it or an onchain bounty is released.

## The problem

Coding agents are excellent at producing code but unreliable as the final authority on whether a task is truly finished. They can overlook acceptance criteria, claim tests passed without running the right commands, introduce security regressions, or produce a polished summary around an incomplete implementation. The developer must repeatedly inspect the diff, reconstruct what was run, and decide whether the evidence is trustworthy.

This becomes more serious when:

- a founder delegates production work to multiple autonomous agents;
- an agency is paid for outcomes rather than hours;
- an OSS maintainer offers a bounty;
- a company uses several agent vendors with different logs and interfaces;
- a remote contributor and task owner do not fully trust one another.

## The solution

DoneBond is an agent-neutral verification and settlement layer.

A task owner defines:

- a human-readable task;
- explicit acceptance criteria;
- a machine-readable verification policy;
- an optional onchain reward.

The contributor or coding agent performs the work. The DoneBond CLI then runs only approved deterministic commands, records exit codes and bounded outputs, gathers the commit/tree/diff state, redacts sensitive values, and creates a canonical evidence bundle. The backend validates the bundle and recomputes its hash. The user anchors the task, policy, commit, and evidence hashes on Monad. Approval credits an optional reward to the contributor using a pull-payment design.

## Unique selling proposition

> **Any agent can write the code. DoneBond independently proves what passed, against which task and commit, and can settle payment for the outcome.**

The differentiation is not merely “proof on a blockchain.” It is the combination of:

1. **Agent neutrality** — Codex, Claude Code, OpenCode, local agents, and humans use the same protocol.
2. **Task-intent binding** — the receipt is tied to acceptance criteria and a policy, not merely to a test run.
3. **Deterministic evidence** — objective commands and exit codes outrank model-generated reviews.
4. **Git-state binding** — proof identifies the exact commit and tree being accepted.
5. **Privacy-preserving anchoring** — source and logs stay offchain; only hashes and minimal state go onchain.
6. **Outcome settlement** — the same trusted state can release a bounty without a separate escrow workflow.
7. **Public portability** — a receipt can be verified independently and shared outside the DoneBond UI.

## Market reality and defensible positioning

Local “proof-of-done” gates already exist, which validates the pain but means a simple CLI that checks whether tests ran would not be exceptional enough. DoneBond must therefore avoid competing as another test wrapper. Its product boundary is broader and more defensible:

| Alternative | What it does | DoneBond differentiation |
|---|---|---|
| CI/test runners | Execute repository checks | Bind checks to explicit task intent, a portable evidence protocol, an exact commit, and public acceptance state |
| Agent-specific completion hooks | Stop one agent from declaring done too early | Work across agents and humans through a neutral CLI/API contract |
| Code-review agents | Produce probabilistic findings | Deterministic checks remain authoritative; AI review is advisory evidence |
| OSS bounty platforms | Coordinate issues and payments | Release is tied to a cryptographic receipt and creator approval, not merely a closed issue |
| Onchain escrow | Holds funds | Adds software-delivery evidence, Git binding, and verifier workflow |

The hackathon MVP must demonstrate this complete wedge. Removing either evidence integrity or settlement would collapse it into an existing category.

## Target users

### Initial wedge

Solo founders and developers who use AI coding agents daily and need a reliable stop condition before merging or deploying.

### Expansion segments

- Small engineering teams operating several agents in parallel
- Open-source maintainers running issue bounties
- Development agencies proving delivery milestones
- Hackathon organizers verifying functional submissions
- AI-agent marketplaces and orchestration platforms
- Internal platform teams enforcing agent quality gates

## Immediate workflow integration

DoneBond should not ask users to abandon existing tools. The first integration surface is:

```bash
npm install -g @donebond/cli
donebond init
donebond task pull <task-id>
# agent works
donebond verify --task <task-id>
donebond submit <bundle-file>
```

A repository can also expose a standard command:

```bash
pnpm donebond:verify
```

The policy file can be committed so every agent and human uses the same checks.

## Why Monad is meaningful

The chain is used for the minimum information that benefits from neutral, tamper-evident state:

- task and policy commitments;
- submitted evidence and commit commitments;
- creator approval or rejection;
- optional funded reward accounting;
- final public receipt events.

The chain is not used as a database for source code, raw logs, credentials, or large evidence objects.

## Business model

### Free developer tier

- Local verification
- Public projects and public receipts
- Limited hosted evidence retention
- Community support

### Pro tier

- Private projects
- Longer evidence retention
- GitHub/GitLab status checks
- Reusable policy templates
- Team members and approval roles
- Audit exports

### Team/Enterprise tier

- SSO/RBAC
- Private runner support
- Custom retention and data residency
- Policy governance
- Organization-wide analytics
- SLA and compliance exports

### Transaction revenue

For funded tasks, DoneBond can charge a small settlement fee or a fixed orchestration fee. This must not be added to the hackathon MVP unless the core settlement flow is already stable.

## Go-to-market

1. Launch as an open-source CLI plus hosted proof viewer.
2. Publish examples for Codex, Claude Code, and OpenCode.
3. Target “agent wrote it, but is it done?” developer communities.
4. Offer a GitHub Action/status-check integration after the hackathon.
5. Partner with OSS bounty programs and agent orchestration products.

## Core metrics

- Verification runs per active repository
- Percentage of first runs that fail and later pass
- Median time from task creation to accepted receipt
- Number and value of funded tasks settled
- Weekly active developers
- Public proof pages shared
- Repeat repositories after first successful receipt

## Moat

The long-term defensibility is a trusted, agent-neutral evidence format and policy ecosystem, accumulated verification history, workflow integrations, and a reputation graph based on verified outcomes rather than self-reported agent claims.

## Deliberate MVP exclusions

Do not build these before the core flow is proven:

- A full GitHub App
- Hosted arbitrary-code runners
- Cross-chain settlement
- Token or NFT issuance
- AI-generated reputation scores
- Multi-party dispute arbitration
- x402 payments
- Enterprise SSO
- A marketplace
- Complex DAO governance

## Hackathon demo story

A founder creates a funded task: “Add rate limiting and tests to this API.” An agent initially implements an incomplete version. DoneBond runs the policy and blocks submission because a security test fails. The agent fixes the issue. The second run passes, generating an evidence bundle tied to the commit. The receipt is anchored on Monad. The founder opens the public proof, approves the task, and the contributor withdraws the reward.
