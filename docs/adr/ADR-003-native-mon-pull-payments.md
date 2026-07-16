# ADR-003: Use optional native MON rewards with pull payments

## Status

Accepted

## Context

The MVP needs one understandable settlement mechanism. Adding custom tokens, ERC-20 allowance UX, fee routing, or cross-chain payment would obscure the proof-of-done story and expand contract risk.

## Decision

A task may be funded with native MON during creation. Approval credits the contributor’s withdrawable balance. Contributors withdraw in a separate reentrancy-protected call.

## Consequences

- Simple demo and accounting model.
- Avoids push-payment failure during approval.
- Requires a second contributor transaction.
- ERC-20 and protocol fees remain future work.
