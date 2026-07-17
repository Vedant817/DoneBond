# DoneBond database package

This package owns the PostgreSQL schema, generated SQL migrations, and the typed
transactional repository used by the API. PostgreSQL is an operational index;
confirmed contract events remain authoritative for onchain lifecycle and funds.

## Local database

Start an isolated development database (the volume is intentionally ephemeral):

```bash
docker compose -f packages/db/compose.yaml up -d --wait
cp packages/db/.env.example packages/db/.env
set -a
source packages/db/.env
set +a
pnpm --filter @donebond/db build
pnpm --filter @donebond/db db:migrate
```

Run migrations against a separate test database before running integration tests.
Never point local commands at a production URL. `DATABASE_SSL=require` is the
default; the example explicitly disables TLS only for loopback development.

The real-PostgreSQL integration test deliberately resets the `public` schema and
therefore requires a database whose name ends in `_test` plus an explicit guard:

```bash
TEST_DATABASE_URL=postgresql://donebond:donebond@127.0.0.1:5432/donebond_test \
DATABASE_SSL=disable \
DONEBOND_ALLOW_DATABASE_RESET=test-only-confirmed \
pnpm --filter @donebond/db test:integration
```

Without `TEST_DATABASE_URL`, the integration test is reported as skipped. A remote
disposable database additionally requires
`DONEBOND_ALLOW_REMOTE_TEST_DATABASE=test-only-confirmed`; production databases
must never be used.

To regenerate a migration after an intentional schema change:

```bash
DATABASE_URL=postgresql://donebond:donebond@127.0.0.1:5432/donebond \
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
- Database TLS uses certificate verification. `DATABASE_SSL=disable` is rejected
  unless the database hostname is loopback; `DATABASE_CA_CERT` can provide a
  private CA bundle without weakening `rejectUnauthorized`.
- Wallet sign-in challenges persist only a SHA-256 nonce digest and bind it to the
  normalized wallet, supported chain, application domain, URI, and strict expiry.
  Consumption is a single conditional update, so concurrent signature replays
  cannot both succeed.
- Browser sessions persist only keyed token and CSRF digests. Active lookup is an
  atomic conditional idle-extension capped by absolute expiry; revoked, idle-
  expired, and absolute-expired sessions cannot be revived. Session rows bind a
  wallet and user with a composite foreign key. CSRF-protected lookups include
  both digests in that conditional update, so invalid CSRF cannot extend a session.

No success-state fixtures are seeded. Tests create their own records and must
destroy them after use.
