import { CheckResult, Heading, Stack, Text } from "@donebond/ui";

export default function HomePage() {
  return (
    <main>
      <Stack gap={4}>
        <Text eyebrow>DoneBond</Text>
        <Heading level={1}>Agents can say it is done. DoneBond shows the proof.</Heading>
        <Text size="md">
          The workspace foundation is running. Product flows will be added only when they are backed
          by real evidence, API, and Monad state.
        </Text>
        <Stack direction="row" gap={2} align="center">
          <CheckResult name="policy" status="passed" />
          <CheckResult name="unit-tests" status="failed" />
        </Stack>
      </Stack>
    </main>
  );
}
