# DoneBond contracts

Immutable Monad registry and pull-payment escrow for DoneBond task commitments.

## Pinned toolchain

- Foundry `1.7.1`
- Solidity `0.8.30` (exact pragma and `solc_version`)
- forge-std `v1.12.0`
- OpenZeppelin Contracts `v5.4.0`

Only the compiler-facing source trees and upstream licenses are vendored under `lib/`;
`DEPENDENCIES.lock` records immutable commits and friendly release tags. To refresh, check out each
recorded commit in a temporary directory, then copy only `forge-std/src` and
`openzeppelin-contracts/contracts` plus their license files. Verify the recorded commits with:

```bash
git ls-remote https://github.com/foundry-rs/forge-std.git refs/tags/v1.12.0
git ls-remote https://github.com/OpenZeppelin/openzeppelin-contracts.git refs/tags/v5.4.0
```

## Build and test

```bash
forge fmt --check
forge build
forge test -vvv
forge test --gas-report
forge coverage --report summary
pnpm abi:check
```

The reviewed ABI is committed at `abi/DoneBondRegistry.json`. `abi:check` derives
the ABI from the pinned compiler and fails when the committed integration artifact
drifts from Solidity source.

The registry intentionally uses `block.timestamp` only for user-selected task deadlines and short-lived
verifier attestations. Validators can skew timestamps slightly, so callers should not use deadlines whose
correctness depends on second-level precision. Exact equality is valid; expiry begins one second later.

The immutable verifier must be a dedicated ECDSA EOA, not a contract wallet. Deployment rejects addresses
that already contain code, and the release smoke test must prove one signed receipt before publishing the
address. The MVP has no review timeout after a receipt is submitted: if the creator loses access or refuses
to decide, the reward remains locked. A future dispute/review-deadline version must address this explicitly.

## Deploy

Create an encrypted Foundry keystore for a dedicated, funded testnet deployer:

```bash
cast wallet new ~/.foundry/keystores donebond-deployer
cast wallet address --account donebond-deployer
```

Fund the printed address with test MON, then deploy from this package directory. Foundry prompts for
the keystore password without exposing the private key:

```bash
export DEPLOYER_ACCOUNT=donebond-deployer
export VERIFIER_ADDRESS=0xYourPassingEvidenceVerifier
pnpm deploy:preflight
forge script script/DeployDoneBondRegistry.s.sol:DeployDoneBondRegistry \
  --account "$DEPLOYER_ACCOUNT" --rpc-url monad_testnet --broadcast
unset DEPLOYER_ACCOUNT VERIFIER_ADDRESS
```

Add `--verify` only after setting the explorer variables documented in the repository environment
template. Record address, transaction hash, chain ID, compiler/optimizer settings, constructor arguments
(`VERIFIER_ADDRESS`), ABI version, deployment commit, and explorer URL after a confirmed deployment.
