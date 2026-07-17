import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import {
  apiIdempotencyKeys,
  chainTransactions,
  cliTokens,
  contractEvents,
  databaseSchema,
  evidenceBundles,
  tasks,
  wallets
} from "../dist/schema.js";

const migrationsUrl = new URL("../migrations/", import.meta.url);

test("schema exposes every MVP entity", () => {
  assert.deepEqual(Object.keys(databaseSchema).sort(), [
    "apiIdempotencyKeys",
    "auditEvents",
    "chainTransactions",
    "cliTokens",
    "contractEvents",
    "evidenceBundles",
    "policies",
    "projectMembers",
    "projects",
    "tasks",
    "users",
    "verificationChecks",
    "wallets"
  ]);
});

test("high-risk identities have database constraints", () => {
  const constraintNames = (table) => {
    const config = getTableConfig(table);
    return new Set([
      ...config.checks.map((item) => item.name),
      ...config.indexes.map((item) => item.config.name),
      ...config.uniqueConstraints.map((item) => item.name)
    ]);
  };

  assert(constraintNames(wallets).has("wallets_chain_address_unique"));
  assert(constraintNames(tasks).has("tasks_chain_identity_unique"));
  assert(constraintNames(evidenceBundles).has("evidence_token_idempotency_unique"));
  assert(
    constraintNames(chainTransactions).has("chain_transactions_user_intent_idempotency_unique")
  );
  assert(constraintNames(contractEvents).has("contract_events_chain_tx_log_unique"));
  assert(constraintNames(apiIdempotencyKeys).has("api_idempotency_scope_operation_key_unique"));
  assert(constraintNames(cliTokens).has("cli_tokens_digest_unique"));
});

test("initial migration includes referential and normalization safeguards", async () => {
  const migrationNames = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql"));
  assert.equal(migrationNames.length, 1);
  const migrationUrl = new URL(migrationNames[0], migrationsUrl);
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /projects_active_policy_same_project_fk/);
  assert.match(sql, /chain_transactions_replaced_by_transaction_id_chain_transactions_id_fk/);
  assert.match(sql, /wallets_address_normalized_format/);
  assert.match(sql, /contract_events_chain_tx_log_unique/);
  assert.match(sql, /evidence_token_idempotency_unique/);
  assert.doesNotMatch(sql, /token_plaintext|private_key|mnemonic/i);
});
