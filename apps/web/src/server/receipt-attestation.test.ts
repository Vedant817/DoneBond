import assert from "node:assert/strict";
import test from "node:test";

import {
  computeReceiptAttestationDigest,
  type ReceiptAttestationDigestInput
} from "@donebond/shared";
import { recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  computeIntegrityStatus,
  isWellFormedPrivateKey,
  signReceiptAttestation
} from "./receipt-attestation.ts";

// A well-known, publicly documented local test private key (Hardhat/Anvil default
// account #0). It never controls real funds and is safe to hardcode in a test file.
const TEST_VERIFIER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const TEST_VERIFIER_ADDRESS = privateKeyToAccount(TEST_VERIFIER_PRIVATE_KEY).address.toLowerCase();

const DIGEST_INPUT: ReceiptAttestationDigestInput = {
  chainId: 10_143,
  contractAddress: `0x${"11".repeat(20)}`,
  taskId: "42",
  taskHash: `0x${"aa".repeat(32)}`,
  policyHash: `0x${"bb".repeat(32)}`,
  assignee: `0x${"cc".repeat(20)}`,
  evidenceHash: `0x${"dd".repeat(32)}`,
  commitHash: `0x${"ee".repeat(32)}`,
  attestationExpiry: "2000000000"
};

test("isWellFormedPrivateKey accepts only 0x-prefixed 32-byte hex values", () => {
  assert.equal(isWellFormedPrivateKey(TEST_VERIFIER_PRIVATE_KEY), true);
  assert.equal(isWellFormedPrivateKey("0x1234"), false);
  assert.equal(isWellFormedPrivateKey(TEST_VERIFIER_PRIVATE_KEY.slice(2)), false);
  assert.equal(isWellFormedPrivateKey(`${TEST_VERIFIER_PRIVATE_KEY}ab`), false);
});

test("signReceiptAttestation produces a digest matching computeReceiptAttestationDigest and a recoverable signature", async () => {
  const result = await signReceiptAttestation(TEST_VERIFIER_PRIVATE_KEY, DIGEST_INPUT);

  const expectedDigest = computeReceiptAttestationDigest(DIGEST_INPUT);
  assert.equal(result.typedDataDigest, expectedDigest);
  assert.equal(result.verifierAddress, TEST_VERIFIER_ADDRESS);

  const recovered = await recoverAddress({
    hash: expectedDigest,
    signature: result.signature
  });
  assert.equal(recovered.toLowerCase(), TEST_VERIFIER_ADDRESS);
});

test("signReceiptAttestation rejects a malformed private key", async () => {
  await assert.rejects(
    () => signReceiptAttestation("0xnotakey" as `0x${string}`, DIGEST_INPUT),
    (error) => error instanceof TypeError
  );
});

test("computeIntegrityStatus is verified only when digest, signer, and configured verifier all agree", async () => {
  const attestation = await signReceiptAttestation(TEST_VERIFIER_PRIVATE_KEY, DIGEST_INPUT);

  assert.equal(
    await computeIntegrityStatus(DIGEST_INPUT, attestation, TEST_VERIFIER_ADDRESS),
    "verified"
  );

  // Wrong configured verifier (e.g. deployment expects a different address).
  const otherAddress = `0x${"22".repeat(20)}`;
  assert.equal(await computeIntegrityStatus(DIGEST_INPUT, attestation, otherAddress), "mismatch");

  // Tampered persisted verifierAddress field, even though signature itself is untouched.
  assert.equal(
    await computeIntegrityStatus(
      DIGEST_INPUT,
      { ...attestation, verifierAddress: otherAddress },
      TEST_VERIFIER_ADDRESS
    ),
    "mismatch"
  );

  // Tampered digest field.
  assert.equal(
    await computeIntegrityStatus(
      DIGEST_INPUT,
      { ...attestation, typedDataDigest: `0x${"ff".repeat(32)}` },
      TEST_VERIFIER_ADDRESS
    ),
    "mismatch"
  );

  // Digest recomputed from different input data no longer matches the stored digest.
  assert.equal(
    await computeIntegrityStatus(
      { ...DIGEST_INPUT, evidenceHash: `0x${"12".repeat(32)}` },
      attestation,
      TEST_VERIFIER_ADDRESS
    ),
    "mismatch"
  );

  // Corrupted signature bytes fail to recover the expected signer.
  const corruptSignature = `0x${"00".repeat(65)}` as `0x${string}`;
  assert.equal(
    await computeIntegrityStatus(
      DIGEST_INPUT,
      { ...attestation, signature: corruptSignature },
      TEST_VERIFIER_ADDRESS
    ),
    "mismatch"
  );
});
