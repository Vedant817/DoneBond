import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chainTransactionStatusTreatment,
  checkStatusTreatment,
  type ChainTransactionStatus,
  type CheckStatus
} from "./status-treatment.ts";

const ALL_CHECK_STATUSES: CheckStatus[] = ["passed", "failed", "timed_out", "skipped", "error"];

const ALL_CHAIN_TRANSACTION_STATUSES: ChainTransactionStatus[] = [
  "prepared",
  "wallet_requested",
  "submitted",
  "confirmed",
  "rejected_by_user",
  "replaced",
  "reverted",
  "unknown_reconcile"
];

test("checkStatusTreatment covers every frozen check status with a non-empty label", () => {
  for (const status of ALL_CHECK_STATUSES) {
    const treatment = checkStatusTreatment(status);
    assert.ok(treatment.label.length > 0, `${status} must have a label`);
    assert.ok(treatment.icon, `${status} must have an icon`);
    assert.ok(treatment.tone, `${status} must have a tone`);
  }
});

test("checkStatusTreatment gives every status a unique label (text alone must disambiguate)", () => {
  const labels = ALL_CHECK_STATUSES.map((status) => checkStatusTreatment(status).label);
  assert.equal(new Set(labels).size, labels.length);
});

test("checkStatusTreatment distinguishes failed (assertion) from error (runner/infra)", () => {
  const failed = checkStatusTreatment("failed");
  const errored = checkStatusTreatment("error");
  assert.notEqual(failed.icon, errored.icon);
  assert.notEqual(failed.label, errored.label);
});

test("chainTransactionStatusTreatment covers every frozen transaction status with a non-empty label", () => {
  for (const status of ALL_CHAIN_TRANSACTION_STATUSES) {
    const treatment = chainTransactionStatusTreatment(status);
    assert.ok(treatment.label.length > 0, `${status} must have a label`);
    assert.ok(treatment.icon, `${status} must have an icon`);
    assert.ok(treatment.tone, `${status} must have a tone`);
  }
});

test("chainTransactionStatusTreatment gives every status a unique label", () => {
  const labels = ALL_CHAIN_TRANSACTION_STATUSES.map(
    (status) => chainTransactionStatusTreatment(status).label
  );
  assert.equal(new Set(labels).size, labels.length);
});

test("chainTransactionStatusTreatment gives every status a unique (icon,label) pair even when tone repeats", () => {
  const pairs = ALL_CHAIN_TRANSACTION_STATUSES.map((status) => {
    const treatment = chainTransactionStatusTreatment(status);
    return `${treatment.icon}:${treatment.label}`;
  });
  assert.equal(new Set(pairs).size, pairs.length);
});
