# ADR-004: Require verifier-attested passing receipts

## Status

Accepted

## Context

The original contract interface allowed an assignee to submit any nonzero evidence
and commit hashes. Creator approval would bind those hashes, but the chain could
not distinguish a server-validated passing bundle from an arbitrary or failing
bundle. DoneBond's required workflow must not allow failed verification to enter
the successful receipt and settlement path.

The server already validates evidence, recomputes commitments, and derives the
passing result. It must not submit wallet transactions or hold user funds.

## Decision

`DoneBondRegistry` has an immutable verifier address configured at deployment.
After validating a passing evidence bundle, the server signs a short-lived EIP-712
attestation. The attestation binds:

- the EIP-712 domain, including chain ID and verifying contract;
- task ID, immutable task hash, and immutable policy hash;
- assignee address;
- evidence hash and derived Git commit hash;
- an expiry timestamp.

The EIP-712 definition is frozen as follows:

```text
domain.name              = "DoneBondRegistry"
domain.version           = "1"
primaryType              = "PassingReceipt"
PassingReceipt           = PassingReceipt(uint256 taskId,bytes32 taskHash,bytes32 policyHash,address assignee,bytes32 evidenceHash,bytes32 commitHash,uint64 attestationExpiry)
PassingReceipt type hash = 0x59d552f1cf676b302e799cde1beeb4544365adc2c515c19ced9e43da442e29ff
signature encoding       = 65-byte 0x-prefixed r || s || v
```

The EIP-712 domain also includes `chainId` and `verifyingContract`. Application
record `schemaVersion` fields are not signed. The shared package publishes a
fixed digest vector, recomputes the digest, and recovers the signature before a
receipt can have verified integrity. The structural receipt schema cannot assign
verified integrity; callers must supply the expected verifier from trusted
contract/deployment state to the asynchronous integrity schema.

Only the assigned contributor can call `submitReceipt`, and the contract accepts
the receipt only when the recovered signer is the configured verifier and the
attestation has not expired. The task state prevents reuse after submission. A
signature for another task, policy, commit, evidence object, assignee, chain, or
contract is invalid.

The verifier key is an application integrity credential, not a user or deployer
wallet. It is stored only in the deployment platform's secret store and can sign
attestations but does not custody task rewards. Rotating the verifier requires a
new immutable contract deployment in the MVP; deployments must clearly version
their verifier and contract addresses.

## Consequences

- Failed or unvalidated evidence cannot enter the onchain receipt state through
  the production flow.
- Contributors retain wallet control over receipt submission and gas payment.
- API evidence validation and verifier-key protection become release-critical.
- Public proofs can independently reconstruct the typed-data digest and signer.
- The ABI includes the attestation expiry and signature.
- Contract tests must cover mutation, expiry, replay, signer, chain, and contract
  domain failures.
