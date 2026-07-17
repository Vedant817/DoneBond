import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";
import {
  ChainTransactionStatusSchema,
  ChainTransactionSchema,
  CheckStatusSchema,
  TaskChainStatusSchema,
  TaskOffchainStatusSchema
} from "../../shared/dist/index.js";

import {
  apiIdempotencyKeys,
  browserSessions,
  chainIntentType,
  chainTransactionStatus,
  checkStatus,
  chainTransactions,
  cliTokens,
  contractEvents,
  databaseSchema,
  evidenceBundles,
  taskChainStatus,
  taskOffchainStatus,
  tasks,
  walletAuthChallenges,
  wallets
} from "../dist/schema.js";

const migrationsUrl = new URL("../migrations/", import.meta.url);

test("schema exposes every MVP entity", () => {
  assert.deepEqual(Object.keys(databaseSchema).sort(), [
    "apiIdempotencyKeys",
    "auditEvents",
    "browserSessions",
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
    "walletAuthChallenges",
    "wallets"
  ]);
});

test("database lifecycle enums exactly match the shared domain", () => {
  assert.deepEqual(taskOffchainStatus.enumValues, TaskOffchainStatusSchema.options);
  assert.deepEqual(taskChainStatus.enumValues, TaskChainStatusSchema.options);
  assert.deepEqual(chainIntentType.enumValues, ChainTransactionSchema.shape.intentType.options);
  assert.deepEqual(chainTransactionStatus.enumValues, ChainTransactionStatusSchema.options);
  assert.deepEqual(checkStatus.enumValues, CheckStatusSchema.options);
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
  assert(constraintNames(walletAuthChallenges).has("wallet_auth_challenges_nonce_digest_unique"));
  assert(constraintNames(browserSessions).has("browser_sessions_token_digest_unique"));
});

test("migration history includes referential and normalization safeguards", async () => {
  const migrationNames = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql"));
  assert(migrationNames.length >= 1);
  const sql = (
    await Promise.all(
      migrationNames.sort().map((name) => readFile(new URL(name, migrationsUrl), "utf8"))
    )
  ).join("\n");
  assert.match(sql, /projects_active_policy_same_project_fk/);
  assert.match(sql, /tasks_policy_same_project_hash_fk/);
  assert.match(sql, /evidence_task_policy_project_fk/);
  assert.match(sql, /evidence_token_project_fk/);
  assert.match(sql, /audit_events_task_project_fk/);
  assert.match(sql, /chain_transactions_replacement_scope_fk/);
  assert.match(sql, /chain_transactions_replacement_state_consistent/);
  assert.match(sql, /wallets_address_normalized_format/);
  assert.match(sql, /contract_events_chain_tx_log_unique/);
  assert.match(sql, /evidence_token_idempotency_unique/);
  assert.match(sql, /evidence_request_hash_format/);
  assert.match(sql, /cli_tokens_digest_format/);
  assert.match(sql, /browser_sessions_wallet_user_fk/);
  assert.match(sql, /browser_sessions_token_digest_format/);
  assert.match(sql, /wallet_auth_challenges_nonce_digest_format/);
  assert.match(sql, /"resource_public_id" varchar\(26\) NOT NULL/);
  assert.doesNotMatch(sql, /token_plaintext|private_key|mnemonic/i);
});
