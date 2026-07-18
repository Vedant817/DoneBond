import { canonicalKeccak256 } from "@donebond/evidence";
import {
  computeReceiptAttestationDigest,
  EvidenceBundleSchema,
  PublicIdentifierSchema
} from "@donebond/shared";
import {
  createPublicClient,
  decodeEventLog,
  http,
  recoverAddress,
  type Address,
  type Hex
} from "viem";

import { readBoundedJson } from "./config.js";
import { CliError, ExitCode } from "./errors.js";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "verifier",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "tasks",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "deadline", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "assignee", type: "address" },
      { name: "reward", type: "uint96" },
      { name: "taskHash", type: "bytes32" },
      { name: "policyHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "commitHash", type: "bytes32" }
    ],
    stateMutability: "view"
  },
  {
    type: "event",
    name: "ReceiptSubmitted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "assignee", type: "address", indexed: true },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "commitHash", type: "bytes32", indexed: false }
    ]
  }
] as const;

interface ReceiptPayload {
  readonly taskPublicId: string;
  readonly projectPublicId: string;
  readonly taskHash: Hex;
  readonly policyHash: Hex;
  readonly creatorWallet: Address;
  readonly assigneeWallet: Address;
  readonly evidenceHash: Hex;
  readonly commitHash: Hex;
  readonly evidenceBundlePublicId: string;
  readonly chainId: 143 | 10_143;
  readonly contractAddress: Address;
  readonly chainTaskId: string;
  readonly submissionTransactionHash: Hex;
  readonly verifierAttestation: {
    readonly verifierAddress: Address;
    readonly signature: Hex;
    readonly typedDataDigest: Hex;
    readonly attestationExpiryUnixSeconds: string;
  };
}

export interface VerifyPublicReceiptOptions {
  readonly receiptId: string;
  readonly apiUrl: string;
  readonly rpcUrl: string;
  readonly fetchImplementation?: typeof fetch;
}

export interface VerifyPublicReceiptResult {
  readonly verified: true;
  readonly receiptId: string;
  readonly evidencePublicId: string;
  readonly evidenceHash: string;
  readonly commitHash: string;
  readonly transactionHash: string;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly verifierAddress: string;
}

function safeOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new CliError("CONFIG_INVALID", `${label} must be a valid URL.`, ExitCode.Configuration, {
      cause
    });
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  ) {
    throw new CliError(
      "CONFIG_INVALID",
      `${label} must use HTTPS without embedded credentials (localhost HTTP is allowed).`,
      ExitCode.Configuration
    );
  }
  url.pathname = url.pathname.replace(/\/$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(
      "CONNECTION_FAILED",
      `DoneBond returned an invalid ${label}.`,
      ExitCode.Network
    );
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`Missing ${key}`);
  return value;
}

function parseReceipt(value: unknown): ReceiptPayload {
  try {
    const wrapper = requireObject(value, "receipt response");
    const receipt = requireObject(wrapper.receipt, "receipt");
    const attestation = requireObject(receipt.verifierAttestation, "verifier attestation");
    const chainId = receipt.chainId;
    if (chainId !== 143 && chainId !== 10_143) throw new TypeError("Unsupported chain");
    return {
      taskPublicId: PublicIdentifierSchema.parse(stringField(receipt, "taskPublicId")),
      projectPublicId: PublicIdentifierSchema.parse(stringField(receipt, "projectPublicId")),
      taskHash: stringField(receipt, "taskHash") as Hex,
      policyHash: stringField(receipt, "policyHash") as Hex,
      creatorWallet: stringField(receipt, "creatorWallet") as Address,
      assigneeWallet: stringField(receipt, "assigneeWallet") as Address,
      evidenceHash: stringField(receipt, "evidenceHash") as Hex,
      commitHash: stringField(receipt, "commitHash") as Hex,
      evidenceBundlePublicId: PublicIdentifierSchema.parse(
        stringField(receipt, "evidenceBundlePublicId")
      ),
      chainId,
      contractAddress: stringField(receipt, "contractAddress") as Address,
      chainTaskId: stringField(receipt, "chainTaskId"),
      submissionTransactionHash: stringField(receipt, "submissionTransactionHash") as Hex,
      verifierAttestation: {
        verifierAddress: stringField(attestation, "verifierAddress") as Address,
        signature: stringField(attestation, "signature") as Hex,
        typedDataDigest: stringField(attestation, "typedDataDigest") as Hex,
        attestationExpiryUnixSeconds: stringField(attestation, "attestationExpiryUnixSeconds")
      }
    };
  } catch (cause) {
    if (cause instanceof CliError) throw cause;
    throw new CliError(
      "CONNECTION_FAILED",
      "DoneBond returned an invalid public receipt.",
      ExitCode.Network,
      { cause }
    );
  }
}

async function publicJson(url: string, fetchImplementation: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
  } catch (cause) {
    throw new CliError(
      "CONNECTION_FAILED",
      "Could not reach the public proof API.",
      ExitCode.Network,
      {
        cause
      }
    );
  }
  if (!response.ok) {
    throw new CliError(
      "CONNECTION_FAILED",
      `Public proof API returned HTTP ${response.status}.`,
      ExitCode.Network
    );
  }
  return readBoundedJson(response);
}

function mismatch(message: string): never {
  throw new CliError("VERIFICATION_FAILED", message, ExitCode.Verification);
}

export async function verifyPublicReceipt(
  options: VerifyPublicReceiptOptions
): Promise<VerifyPublicReceiptResult> {
  const receiptId = PublicIdentifierSchema.parse(options.receiptId);
  const apiUrl = safeOrigin(options.apiUrl, "API URL");
  const rpcUrl = safeOrigin(options.rpcUrl, "RPC URL");
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const receipt = parseReceipt(
    await publicJson(
      `${apiUrl}/api/v1/receipt/${encodeURIComponent(receiptId)}`,
      fetchImplementation
    )
  );
  if (receipt.taskPublicId !== receiptId) mismatch("Receipt ID does not match its task.");
  const evidenceResponse = requireObject(
    await publicJson(
      `${apiUrl}/api/v1/evidence/${encodeURIComponent(receipt.evidenceBundlePublicId)}`,
      fetchImplementation
    ),
    "evidence response"
  );
  const evidenceRecord = requireObject(evidenceResponse.evidence, "evidence");
  const bundle = EvidenceBundleSchema.parse(evidenceRecord.bundle);
  const evidenceHash = canonicalKeccak256(bundle);
  if (
    evidenceHash !== receipt.evidenceHash ||
    bundle.task.publicId !== receipt.taskPublicId ||
    bundle.task.taskHash !== receipt.taskHash ||
    bundle.policy.policyHash !== receipt.policyHash ||
    bundle.git.derivedCommitHash !== receipt.commitHash ||
    !bundle.result.passing
  ) {
    mismatch("Public evidence commitments do not match the receipt.");
  }

  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 15_000 }) });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== receipt.chainId) mismatch("RPC chain does not match the receipt chain.");
  const verifier = await client.readContract({
    address: receipt.contractAddress,
    abi: REGISTRY_ABI,
    functionName: "verifier"
  });
  if (verifier.toLowerCase() !== receipt.verifierAttestation.verifierAddress.toLowerCase()) {
    mismatch("Receipt verifier does not match the contract's immutable verifier.");
  }
  const digest = computeReceiptAttestationDigest({
    chainId: receipt.chainId,
    contractAddress: receipt.contractAddress,
    taskId: receipt.chainTaskId,
    taskHash: receipt.taskHash,
    policyHash: receipt.policyHash,
    assignee: receipt.assigneeWallet,
    evidenceHash: receipt.evidenceHash,
    commitHash: receipt.commitHash,
    attestationExpiry: receipt.verifierAttestation.attestationExpiryUnixSeconds
  });
  const signer = await recoverAddress({
    hash: digest,
    signature: receipt.verifierAttestation.signature
  });
  if (
    digest !== receipt.verifierAttestation.typedDataDigest ||
    signer.toLowerCase() !== verifier.toLowerCase()
  ) {
    mismatch("Verifier attestation digest or signature is invalid.");
  }
  const task = await client.readContract({
    address: receipt.contractAddress,
    abi: REGISTRY_ABI,
    functionName: "tasks",
    args: [BigInt(receipt.chainTaskId)]
  });
  const [creator, , status, assignee, , taskHash, policyHash, onchainEvidence, onchainCommit] =
    task;
  if (
    ![2, 3, 4].includes(status) ||
    creator.toLowerCase() !== receipt.creatorWallet.toLowerCase() ||
    assignee.toLowerCase() !== receipt.assigneeWallet.toLowerCase() ||
    taskHash !== receipt.taskHash ||
    policyHash !== receipt.policyHash ||
    onchainEvidence !== receipt.evidenceHash ||
    onchainCommit !== receipt.commitHash
  ) {
    mismatch("Onchain task state does not match the public receipt.");
  }
  const transaction = await client.getTransactionReceipt({
    hash: receipt.submissionTransactionHash
  });
  if (
    transaction.status !== "success" ||
    transaction.to?.toLowerCase() !== receipt.contractAddress.toLowerCase()
  ) {
    mismatch("Receipt transaction is not a successful call to the configured contract.");
  }
  const eventMatches = transaction.logs.filter((log) => {
    if (log.address.toLowerCase() !== receipt.contractAddress.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics });
      return (
        decoded.eventName === "ReceiptSubmitted" &&
        decoded.args.taskId === BigInt(receipt.chainTaskId) &&
        decoded.args.assignee.toLowerCase() === receipt.assigneeWallet.toLowerCase() &&
        decoded.args.evidenceHash === receipt.evidenceHash &&
        decoded.args.commitHash === receipt.commitHash
      );
    } catch {
      return false;
    }
  });
  if (eventMatches.length !== 1) mismatch("ReceiptSubmitted event is missing or ambiguous.");
  return {
    verified: true,
    receiptId,
    evidencePublicId: receipt.evidenceBundlePublicId,
    evidenceHash,
    commitHash: receipt.commitHash,
    transactionHash: receipt.submissionTransactionHash,
    chainId: receipt.chainId,
    contractAddress: receipt.contractAddress,
    verifierAddress: verifier
  };
}
