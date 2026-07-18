# Source Notes

These are external references used to shape the build plan. Re-check current values and instructions before deployment because network endpoints and tooling can change.

## Monad

- Documentation: https://docs.monad.xyz/
- Developer portal: https://developers.monad.xyz/
- Smart-contract deployment guide: https://docs.monad.xyz/guides/deploy-smart-contract/index
- Contract verification guide: consult current official Monad documentation/explorer instructions.

At research time, official developer resources documented Monad’s EVM-compatible tooling and a Testnet configuration using chain ID 10143. Treat `.env.example` values as development defaults that must be confirmed before release.

## Security/tooling

- OpenZeppelin contracts: https://docs.openzeppelin.com/contracts/
- Foundry book: https://book.getfoundry.sh/
- viem: https://viem.sh/
- wagmi: https://wagmi.sh/

Use primary documentation for implementation details and pin actual dependency versions in the repository.

## Adjacent products

A current GitHub topic search shows small “proof-of-done” tools for coding agents. This validates demand but also means DoneBond must not present a local test gate as its entire innovation. Its differentiated MVP is the complete task-intent + deterministic evidence + exact Git state + public onchain commitment + optional outcome settlement workflow.
