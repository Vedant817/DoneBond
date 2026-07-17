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
  produced by the authentication service; `token_prefix` is non-secret display
  metadata.
- Idempotent writes bind actor, operation, key, and request hash. Reusing a key
  with different content returns `DB_IDEMPOTENCY_CONFLICT`.
- Evidence plus check summaries and lifecycle audit records are inserted in one
  transaction.
- Contract logs are unique by `(chain_id, transaction_hash, log_index)` and also
  retain block hashes and removal state for reconciliation.

No success-state fixtures are seeded. Tests create their own records and must
destroy them after use.
