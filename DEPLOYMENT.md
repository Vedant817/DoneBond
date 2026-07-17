# Deployment Runbook

## Environments

### Local

- Local PostgreSQL or an isolated development database
- Local web/API and CLI package
- Foundry local chain for contract iteration
- No production secrets

### Preview

- Per-branch web deployment where supported
- Isolated or carefully namespaced database
- Monad Testnet only
- Preview URLs must not expose private evidence

### Production hackathon environment

- Public web/API URL
- Managed PostgreSQL
- Secure object storage if evidence is not stored in the database
- Verified Monad Testnet contract
- Public proof routes

## Environment validation

Fail fast at process startup for missing or malformed required values. Keep client-visible values separate from server secrets.

Suggested variables are listed in `.env.example`.

## Confirmed Monad Testnet configuration

Reconfirmed against the official Monad Developer Portal and network changelog on
2026-07-17:

- chain ID: `10143`;
- public RPC: `https://rpc.testnet.monad.xyz`;
- explorer: `https://testnet.monadscan.com`;
- native symbol: `MON`.

Sources: [Monad Developer Portal](https://developers.monad.xyz/) and
[official chain configuration changelog](https://docs.monad.xyz/developer-essentials/changelog).
Reconfirm these values immediately before broadcast. A documentation check does
not replace `cast chain-id` and a funded-wallet preflight from the deployment
environment.

## Contract deployment procedure

1. Reconfirm current chain ID, RPC, explorer, faucet, and verification instructions from official Monad documentation.
2. Create or use a dedicated deployment wallet with only required test MON.
3. Store the private key in the local secret environment, never in files committed to Git.
4. Run contract tests, coverage, and security review.
5. Deploy from the exact release commit.
6. Verify source and constructor arguments.
7. Save the deployment artifact including:
   - chain ID;
   - contract address;
   - deployment transaction;
   - block number;
   - compiler/optimizer settings;
   - ABI hash;
   - Git commit.
8. Execute the live smoke sequence using small testnet values.

## Database deployment

- Review generated migrations.
- Back up production data before destructive changes.
- Run migrations as a dedicated release step, not implicitly from every web process.
- Verify constraints and indexes after migration.
- Seed no fake production tasks or passing receipts.

## Web/API deployment

- Use a pinned Node/package-manager version.
- Install with frozen lockfile.
- Run format check, lint, typecheck, tests, and build before deploy.
- Set secrets through the hosting provider.
- Configure secure headers and HTTPS.
- Restrict preview/prod environment access appropriately.
- Ensure server logs redact authorization headers and evidence content.

## Event reconciliation

For the hackathon, a lightweight scheduled reconciliation job is sufficient if reliable:

- query pending transaction records;
- fetch receipts and contract events;
- update confirmed/reverted/replaced/unknown state idempotently;
- retry transient RPC failures with bounded exponential backoff;
- do not mark a transaction failed solely on timeout.

## Release smoke test

Perform from a fresh browser profile and a fresh local clone:

1. Open the public landing page.
2. Sign in and connect the supported wallet/network.
3. Create a project and CLI token.
4. Initialize CLI.
5. Create a funded test task.
6. Produce a failed verification.
7. Fix/commit and produce passing verification.
8. Upload evidence and submit receipt.
9. Confirm explorer/public proof.
10. Approve and withdraw.
11. Refresh every page and confirm state remains correct.

## Rollback strategy

- Web/API: redeploy the last known-good build.
- Database: use forward-fix migrations; maintain backups for destructive failure.
- Contract: immutable MVP cannot be upgraded. If a critical defect exists, stop using it, deploy a corrected version, update configuration, and clearly mark the old contract deprecated. Never hide the redeployment.
