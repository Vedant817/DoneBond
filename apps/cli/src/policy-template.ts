export const POLICY_TEMPLATE = `schemaVersion: 1
repository:
  requireCleanWorkingTree: true
  allowedBranches:
    - main
checks:
  - key: test
    label: Test suite
    executable: pnpm
    args:
      - test
    cwd: .
    timeoutSeconds: 600
    required: true
    maxOutputBytes: 262144
    environmentAllowlist:
      - CI
environment:
  allow:
    - CI
redaction:
  additionalPatterns: []
`;
