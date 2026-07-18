# DoneBond database package

This package owns the PostgreSQL schema, generated SQL migrations, and the typed
transactional repository used by the API. PostgreSQL is an operational index;
confirmed contract events remain authoritative for onchain lifecycle and funds.

## Local database

DoneBond uses a hosted Supabase Postgres project rather than a local Docker
database. Create a project at https://supabase.com, then copy its direct
connection string (Project Settings -> Database -> Connection string -> URI,
port 5432, `db.<project-ref>.supabase.co` — use the direct connection, not the
pooled one, so migrations can run DDL):

```bash
cp packages/db/.env.example packages/db/.env
# edit packages/db/.env: paste the Supabase URI into DATABASE_URL
set -a
source packages/db/.env
set +a
pnpm db:migrate
```

For the deployed Vercel application, use Supabase's IPv4-compatible Supavisor
transaction-pooler URI (normally port 6543) instead. The runtime disables
session-scoped prepared statements so transaction pooling remains safe; keep the
direct URI restricted to migration/release tooling.

Run migrations against a separate test project/database before running
integration tests. Never point local commands at a production URL. Supabase
requires TLS. `DATABASE_SSL=require` is this project's compatible default: it
encrypts traffic but does not verify the server certificate. Production should
prefer `DATABASE_SSL=verify-full` with Supabase's downloaded CA certificate in
`DATABASE_CA_CERT`. TLS can only be disabled for a literal loopback hostname
(`localhost`/`127.0.0.1`/`::1`).

The real-PostgreSQL integration test deliberately resets the `public` schema and
therefore requires a database whose name ends in `_test` plus an explicit guard.
Create a second, disposable Supabase project (or a separate database) for this —
never point it at anything shared:

```bash
TEST_DATABASE_URL=postgresql://postgres:<password>@db.<test-project-ref>.supabase.co:5432/postgres_test \
DONEBOND_ALLOW_DATABASE_RESET=test-only-confirmed \
DONEBOND_ALLOW_REMOTE_TEST_DATABASE=test-only-confirmed \
pnpm --filter @donebond/db test:integration
```

Without `TEST_DATABASE_URL`, the integration test is reported as skipped.
`DONEBOND_ALLOW_REMOTE_TEST_DATABASE` is required in addition to the reset guard
because a Supabase host is never loopback; production databases must never be
used regardless.

To regenerate a migration after an intentional schema change:

```bash
DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres \
  pnpm --filter @donebond/db db:generate
```

Review generated SQL before committing it. Do not edit an applied migration;
create a new migration instead.

## Data and security boundaries

- Public routes use `public_id`; internal UUIDs are never part of public URLs.
- Wallets and contract addresses are stored as lowercase normalized values.
- CLI token plaintext is never stored. `token_digest` holds only a strong digest
  produced by the authentication service as exactly 32 bytes encoded to 64
  lowercase hexadecimal characters; `token_prefix` is non-secret display metadata.
- Idempotent writes bind actor, operation, key, request hash, and the non-null
  resource public ID in the same transaction as the resource and audit record.
  Reusing a key with different content returns `DB_IDEMPOTENCY_CONFLICT`.
- Evidence plus check summaries and lifecycle audit records are inserted in one
  transaction. The repository locks and verifies task, policy, project, and
  non-revoked token bindings, requires a deterministic required check, and derives
  the persisted passing value from check outcomes.
- Contract logs are unique by `(chain_id, transaction_hash, log_index)` and also
  retain block hashes and removal state for reconciliation. Exact replay is a
  no-op; removed/canonical transitions are updated and audited atomically.
- Database TLS supports encrypted compatibility with `DATABASE_SSL=require` and
  certificate/hostname verification with `DATABASE_SSL=verify-full` plus
  `DATABASE_CA_CERT`. `DATABASE_SSL=disable` is rejected unless the hostname is
  loopback.
- Wallet sign-in challenges persist only a SHA-256 nonce digest and bind it to the
  normalized wallet, supported chain, application domain, URI, and strict expiry.
  Consumption is a single conditional update, so concurrent signature replays
  cannot both succeed.
- Browser sessions persist only keyed token and CSRF digests. Active lookup is an
  atomic conditional idle-extension capped by absolute expiry; revoked, idle-
  expired, and absolute-expired sessions cannot be revived. Session rows bind a
  wallet and user with a composite foreign key. CSRF-protected lookups include
  both digests in that conditional update, so invalid CSRF cannot extend a session.
- Authentication rate limits use a PostgreSQL fixed-window counter keyed by a
  lowercase SHA-256 digest and explicit scope. A conditional upsert makes the
  allow/deny decision atomically across application instances; expiry-indexed,
  bounded cleanup avoids unbounded stale-row accumulation and long cleanup locks.
- Project CLI tokens persist only a caller-produced keyed SHA-256 digest and a
  short display prefix. Owner-scoped creation is idempotency-bound, revocation is
  idempotent, and successful authentication atomically advances `last_used_at`
  only when the digest is active and belongs to the exact requested project.

No success-state fixtures are seeded. Tests create their own records and must
destroy them after use.
