# ADR-002: Store commitments, not source code or logs, onchain

## Status

Accepted

## Context

Source code, test output, and environment details can be large and sensitive. Publishing them permanently would harm privacy and increase cost. The chain’s valuable role is neutral integrity and lifecycle state.

## Decision

Store task, policy, evidence, and derived Git commitments plus minimal actors/status/reward accounting on Monad. Store safe evidence offchain and expose it through a public proof only when the project permits it.

## Consequences

- Public events are compact and privacy-conscious.
- A proof viewer must combine offchain evidence with onchain commitments.
- Evidence availability requires an offchain retention strategy; downloadable bundles allow independent archiving.
