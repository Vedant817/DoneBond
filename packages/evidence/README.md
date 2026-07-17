# DoneBond evidence engine

This package is the security-sensitive, Node-only implementation of DoneBond's
version-1 evidence protocol. It parses committed YAML policies, executes checks
without a shell, bounds and redacts output, collects exact Git state, generates
RFC 8785 canonical commitments, writes safe human-readable bundles, and verifies
bundles independently.

## Trust and privacy boundaries

- Checks run only on the user's machine. The package never offers hosted command
  execution and never accepts a shell command string.
- The public bundle contains the normalized remote identity, branch, object/tree
  IDs, dirty-file names, and check output previews. Full author/committer identity,
  absolute paths, and diff/source contents stay in the local `CollectedGitState`.
  Raw V1 bundles for private projects must remain access-controlled because their
  remote identity, changed paths, and redacted previews are not public-safe by
  default; a public API must apply its explicit field allowlist.
- Default and validated project patterns redact output before persistence and
  hashing. A residual high-confidence secret match rejects the bundle.
- A required check failure, timeout, missing executable, dirty tree, hash
  mutation, or unsupported policy constraint fails closed.

## Version-1 repository-constraint limitation

The frozen shared `EvidenceBundleV1` derives `result.passing` from required check
outcomes and clean Git state. It has no field for branch, remote-owner, or
base-commit constraint outcomes. To prevent a false passing receipt, this package
refuses to build a bundle when branch or remote-owner constraints fail. Base
commit ancestry is evaluated by `collectGitState`; building requires that local
result, and independent `verifyBundle` requires matching repository context when
the policy declares a base commit. A future schema version may encode these
constraint results directly. The public object/tree IDs still let a third party
inspect the bound commit independently.

## Direct verification

From the repository root:

```bash
pnpm --filter @donebond/evidence test
pnpm --filter @donebond/evidence typecheck
```

Frozen task, policy, Git commit, and evidence vectors are under `test/fixtures/`.
