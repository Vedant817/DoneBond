# Decision Log

Use this file for concise project-level decisions. Use a full ADR under `docs/adr/` for material architectural changes.

| Date | Decision | Reason | Consequence |
|---|---|---|---|
| Initial | Build DoneBond as an agent-neutral proof-of-done layer | Solves a personal and rapidly growing workflow problem with an immediately demonstrable SaaS wedge | All features must support the one verification-to-settlement loop |
| Initial | Run arbitrary project checks locally, not on hosted servers | Reduces remote-code-execution risk and infrastructure scope | Hosted product validates uploaded evidence rather than executing user code |
| Initial | Put commitments and funds onchain, not source/logs | Preserves privacy and controls cost while retaining neutral integrity | Public proof combines offchain bundle and onchain event |
| Initial | Use optional native MON pull payments | Keeps settlement understandable and avoids unnecessary token complexity | Contributor performs a separate withdrawal transaction |
| Initial | Use a fresh repository under personal account | Hackathon eligibility and correct account separation | Git identity checker is a release gate |
