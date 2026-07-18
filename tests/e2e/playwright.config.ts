import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm --filter @donebond/web start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://donebond:donebond@127.0.0.1:5432/donebond",
      DATABASE_SSL: process.env.DATABASE_SSL ?? "disable",
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3100",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "Y2ktZGV0ZXJtaW5pc3RpYy1hdXRoLXNlY3JldC0zMi1ieXRlcw",
      CLI_TOKEN_SECRET:
        process.env.CLI_TOKEN_SECRET ?? "Y2ktZGV0ZXJtaW5pc3RpYy1jbGktc2VjcmV0LTMyLWJ5dGVz",
      NEXT_PUBLIC_MONAD_CHAIN_ID: process.env.NEXT_PUBLIC_MONAD_CHAIN_ID ?? "10143",
      NEXT_PUBLIC_MONAD_RPC_URL:
        process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
      MONAD_RPC_URL: process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
      NEXT_PUBLIC_MONAD_EXPLORER_URL:
        process.env.NEXT_PUBLIC_MONAD_EXPLORER_URL ?? "https://testnet.monadscan.com",
      NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS:
        process.env.NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS ??
        "0x0000000000000000000000000000000000000001",
      DONEBOND_DEPLOYMENT_BLOCK: process.env.DONEBOND_DEPLOYMENT_BLOCK ?? "1",
      DONEBOND_CONFIRMATIONS: process.env.DONEBOND_CONFIRMATIONS ?? "1",
      VERIFIER_PRIVATE_KEY:
        process.env.VERIFIER_PRIVATE_KEY ??
        "0x1111111111111111111111111111111111111111111111111111111111111111"
    }
  }
});
