# ADR-001: Execute project verification locally

## Status

Accepted

## Context

Executing arbitrary repository commands on hosted DoneBond infrastructure would create a remote-code-execution platform, require strong sandboxing, increase cost, and expand the initial scope. The target users already run coding agents and tests locally.

## Decision

The MVP CLI executes policy-approved commands on the contributor’s machine. The hosted API validates the resulting bounded, redacted, canonical evidence bundle and recomputes its commitments. Hosted runners are excluded from MVP.

## Consequences

- Much smaller attack surface and infrastructure burden.
- Immediate compatibility with private and unusual repositories.
- Evidence initially relies on the integrity of the open-source CLI and server validation; future versions may add signed isolated runners or multiple verifier attestations.
- UI and copy must avoid claiming that local execution alone makes results universally trustworthy.
