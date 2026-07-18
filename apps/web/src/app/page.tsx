import {
  CheckResult,
  CodeBlock,
  Heading,
  HashDisplay,
  InlineCode,
  Stack,
  Text,
  TransactionState
} from "@donebond/ui";

const CREATE_PROJECT_PATH = "/projects/new";

// Illustrative-only values for the example below. The real public receipt API
// is available at /api/v1/receipt/[receiptId], and confirmed receipts have a
// shareable page at /proof/[publicId].
const EXAMPLE_RECEIPT = {
  taskTitle: "Add cursor pagination to GET /tasks",
  taskHash: "0x14c05321a220bffaf8c927e5d17bd3530ae6c01c527a18929e7a9baf36ae6546",
  policyHash: "0xb4bf92c832f4b3a2404b4e4771e4be0f7f0ecd49e275f646894f1201a5633dc6",
  evidenceHash: "0x6a7fc90681027a29b6d2abeaa02effd369cb2100e3ff27c17f766fc24e9ed0ab",
  commitHash: "0xe68aaf26d4ca7d76be61309b8bfdd35443fc8e1e871cf58040257cc34f0377b5",
  receiptTxHash: "0x417a8e3c3c4ac128283fb66a98f6acb0908c064e4b63f4cafef282e3155e7fdf"
};

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing-section" aria-labelledby="hero-heading">
        <Stack gap={5}>
          <Text eyebrow>DoneBond</Text>
          <Heading level={1} id="hero-heading">
            Agents can say a task is done. DoneBond makes them prove it.
          </Heading>
          <Text size="md" tone="strong">
            A task owner writes acceptance criteria and a checked-in verification policy. A
            contributor — human or AI agent — does the work, then runs the DoneBond CLI, which
            independently executes that policy against the exact Git commit and produces a
            cryptographically hashed evidence bundle. If it passes, the contributor&apos;s own
            wallet anchors a compact receipt on Monad, tying the evidence and commit to an
            immutable, timestamped record. Nothing is graded from a screenshot or a promise.
          </Text>
          <div className="landing-hero-actions">
            <a className="landing-cta-link landing-cta-link--primary" href={CREATE_PROJECT_PATH}>
              Create project
            </a>
            <a className="landing-cta-link landing-cta-link--secondary" href="#evidence-vs-chain">
              How verification works
            </a>
          </div>
        </Stack>
      </section>

      <section
        className="landing-section"
        aria-labelledby="evidence-vs-chain-heading"
        id="evidence-vs-chain"
      >
        <Stack gap={5}>
          <Heading level={2} id="evidence-vs-chain-heading">
            Evidence proves the work. The chain proves the proof wasn&apos;t altered.
          </Heading>
          <Text size="md">
            These are two different jobs, done by two different systems. Collapsing them into
            &quot;the blockchain verifies your code&quot; would misdescribe what actually happens.
          </Text>
          <div className="landing-two-column">
            <div className="landing-panel">
              <Stack gap={3}>
                <Text eyebrow>Off-chain, run by the CLI</Text>
                <Heading level={3}>What actually gets checked</Heading>
                <Text size="sm">
                  Your policy file (checks, commands, timeouts) is committed to the repo, not
                  configured in a UI. The DoneBond CLI reads it, runs those exact commands against
                  the exact Git commit on the contributor&apos;s own machine, and canonicalizes the
                  task, policy, commit, and results into a hashed evidence bundle. This is the step
                  where pass/fail is actually decided — no server re-runs your tests.
                </Text>
              </Stack>
            </div>
            <div className="landing-panel">
              <Stack gap={3}>
                <Text eyebrow>On-chain, anchored by the receipt</Text>
                <Heading level={3}>What Monad actually does</Heading>
                <Text size="sm">
                  The chain never executes a test, a linter, or a build, and has no way to judge
                  code quality. Once evidence passes, the contributor&apos;s wallet submits a small
                  receipt transaction carrying the evidence/commit hash commitments plus a signed
                  attestation from DoneBond&apos;s verifier key. What the chain adds is what files
                  alone can&apos;t: an immutable, timestamped, tamper-evident record that this exact
                  evidence existed and was attested — plus, optionally, escrow/release accounting
                  for a MON reward.
                </Text>
              </Stack>
            </div>
          </div>
          <Text size="sm" tone="muted">
            In short: the CLI decides whether the work passed. The chain only anchors that decision
            so it can&apos;t be quietly rewritten later — it is not a verifier, and it does not
            judge correctness.
          </Text>
        </Stack>
      </section>

      <section className="landing-section" aria-labelledby="install-heading">
        <Stack gap={4}>
          <Heading level={2} id="install-heading">
            Run the CLI
          </Heading>
          <Text size="md">
            CLI distribution hasn&apos;t shipped yet, so there is no published package to install
            today. From a checkout of this monorepo, build and run it directly:
          </Text>
          <CodeBlock>{`pnpm install\npnpm --filter @donebond/cli build\nnode apps/cli/dist/index.js init\nnode apps/cli/dist/index.js verify`}</CodeBlock>
          <Text size="sm" tone="muted">
            Once distribution lands, the same tool is intended to install as{" "}
            <InlineCode>npm install -g donebond</InlineCode> — coming soon, not yet published.
          </Text>
        </Stack>
      </section>

      <section className="landing-section" aria-labelledby="receipt-heading">
        <Stack gap={4}>
          <Heading level={2} id="receipt-heading">
            Example receipt
          </Heading>
          <Text size="md" tone="muted">
            Illustrative only — this is a mockup built from the real design-system components, not a
            live task. Confirmed receipts are available through the public API and the shareable
            visual proof page.
          </Text>
          <div className="landing-panel">
            <Stack gap={4}>
              <Stack gap={1}>
                <Text eyebrow>Example task</Text>
                <Heading level={3}>{EXAMPLE_RECEIPT.taskTitle}</Heading>
              </Stack>
              <Stack direction="row" gap={2} align="center">
                <CheckResult name="policy" status="passed" />
                <CheckResult name="unit-tests" status="passed" />
                <CheckResult name="lint" status="passed" />
              </Stack>
              <Stack gap={2}>
                <HashDisplay label="Task hash" value={EXAMPLE_RECEIPT.taskHash} />
                <HashDisplay label="Policy hash" value={EXAMPLE_RECEIPT.policyHash} />
                <HashDisplay label="Evidence hash" value={EXAMPLE_RECEIPT.evidenceHash} />
                <HashDisplay label="Commit hash" value={EXAMPLE_RECEIPT.commitHash} />
                <HashDisplay
                  label="Receipt transaction hash"
                  value={EXAMPLE_RECEIPT.receiptTxHash}
                />
              </Stack>
              <Stack direction="row" gap={2} align="center">
                <Text size="sm" tone="muted">
                  Receipt transaction:
                </Text>
                <TransactionState status="confirmed" />
              </Stack>
            </Stack>
          </div>
        </Stack>
      </section>

      <section className="landing-section" aria-labelledby="create-project-heading">
        <Stack gap={4}>
          <Heading level={2} id="create-project-heading">
            Create a project
          </Heading>
          <Text size="md">
            Define acceptance criteria and a verification policy for a task, invite a contributor,
            and let the CLI and the chain do the rest — evidence off-chain, tamper-evident receipt
            on-chain.
          </Text>
          <div className="landing-hero-actions">
            <a className="landing-cta-link landing-cta-link--primary" href={CREATE_PROJECT_PATH}>
              Create project
            </a>
          </div>
          <Text size="xs" tone="muted">
            Connect a Monad Testnet wallet to create and manage a project.
          </Text>
        </Stack>
      </section>
    </main>
  );
}
