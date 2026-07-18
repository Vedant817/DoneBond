import {
  computeReceiptAttestationDigest,
  PASSING_RECEIPT_TYPES,
  VERIFIER_ATTESTATION_DOMAIN_NAME,
  VERIFIER_ATTESTATION_DOMAIN_VERSION,
  VERIFIER_ATTESTATION_PRIMARY_TYPE,
  type ReceiptAttestationDigestInput
} from "@donebond/shared";
import { recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

/**
 * Returns true when `value` looks like a well-formed 32-byte hex private key.
 * This is a shape check only; it cannot confirm the key controls any
 * particular address (that is verified separately at startup by recovering
 * the configured verifier address, see `receipt-runtime.ts`).
 */
export function isWellFormedPrivateKey(value: string): value is `0x${string}` {
  return PRIVATE_KEY_PATTERN.test(value);
}

export interface ReceiptAttestationResult {
  readonly signature: `0x${string}`;
  readonly typedDataDigest: `0x${string}`;
  readonly verifierAddress: string;
}

/**
 * Signs an EIP-712 `PassingReceipt` attestation with the given verifier
 * private key.
 *
 * This function is pure aside from the ECDSA signing operation itself: the
 * private key is an explicit parameter (never read from `process.env` here),
 * making it independently testable and keeping the only place that touches
 * `VERIFIER_PRIVATE_KEY` confined to `receipt-runtime.ts`. The digest is
 * computed twice on purpose — once via `computeReceiptAttestationDigest` for
 * persistence/display, and once implicitly inside `signTypedData` using the
 * identical domain/types/message — and the two must agree; callers should
 * treat any mismatch as a defect in this module, not the caller's input.
 *
 * The returned signature never touches the network or submits a transaction;
 * it is one input field the assignee's own wallet later includes in its own
 * `submitReceipt` call.
 */
export async function signReceiptAttestation(
  verifierPrivateKey: `0x${string}`,
  input: ReceiptAttestationDigestInput
): Promise<ReceiptAttestationResult> {
  if (!isWellFormedPrivateKey(verifierPrivateKey)) {
    throw new TypeError("Verifier private key must be a 0x-prefixed 32-byte hexadecimal value");
  }
  const account = privateKeyToAccount(verifierPrivateKey);
  const typedDataDigest = computeReceiptAttestationDigest(input);
  const signature = await account.signTypedData({
    domain: {
      name: VERIFIER_ATTESTATION_DOMAIN_NAME,
      version: VERIFIER_ATTESTATION_DOMAIN_VERSION,
      chainId: input.chainId,
      verifyingContract: input.contractAddress as `0x${string}`
    },
    types: PASSING_RECEIPT_TYPES,
    primaryType: VERIFIER_ATTESTATION_PRIMARY_TYPE,
    message: {
      taskId: BigInt(input.taskId),
      taskHash: input.taskHash as `0x${string}`,
      policyHash: input.policyHash as `0x${string}`,
      assignee: input.assignee as `0x${string}`,
      evidenceHash: input.evidenceHash as `0x${string}`,
      commitHash: input.commitHash as `0x${string}`,
      attestationExpiry: BigInt(input.attestationExpiry)
    }
  });
  return {
    signature,
    typedDataDigest,
    verifierAddress: account.address.toLowerCase()
  };
}

/**
 * Independently recomputes the attestation digest for `input` and recovers
 * the signer of `attestation.signature`, returning `"verified"` only if the
 * recovered signer, the persisted `verifierAddress`, and the configured
 * `expectedVerifierAddress` all agree and the persisted digest matches the
 * recomputed one. This is the same trust boundary as
 * `createVerifiedReceiptSchema` in `@donebond/shared` — the caller must supply
 * the deployment's trusted verifier address, never a value taken from the
 * receipt itself.
 */
export async function computeIntegrityStatus(
  input: ReceiptAttestationDigestInput,
  attestation: {
    readonly verifierAddress: string;
    readonly signature: string;
    readonly typedDataDigest: string;
  },
  expectedVerifierAddress: string
): Promise<"verified" | "mismatch"> {
  const expectedVerifier = expectedVerifierAddress.toLowerCase();
  const expectedDigest = computeReceiptAttestationDigest(input);
  if (
    attestation.verifierAddress.toLowerCase() !== expectedVerifier ||
    attestation.typedDataDigest.toLowerCase() !== expectedDigest.toLowerCase()
  ) {
    return "mismatch";
  }
  try {
    const recovered = await recoverAddress({
      hash: expectedDigest,
      signature: attestation.signature as `0x${string}`
    });
    return recovered.toLowerCase() === expectedVerifier ? "verified" : "mismatch";
  } catch {
    return "mismatch";
  }
}
