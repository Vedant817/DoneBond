import assert from "node:assert/strict";
import test from "node:test";

import { loadChainConfiguration } from "../dist/index.js";

test("loads a supported Monad chain configuration", () => {
  assert.deepEqual(
    loadChainConfiguration({
      NEXT_PUBLIC_MONAD_CHAIN_ID: "10143",
      NEXT_PUBLIC_MONAD_RPC_URL: "https://rpc.example.test",
      NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS: "0xAABBCCDDEEFF0011223344556677889900AABBCC",
      NEXT_PUBLIC_MONAD_EXPLORER_URL: "https://explorer.example.test",
      DONEBOND_DEPLOYMENT_BLOCK: "123"
    }),
    {
      chainId: 10143,
      name: "Monad Testnet",
      rpcUrl: "https://rpc.example.test/",
      publicRpcUrl: "https://rpc.example.test/",
      contractAddress: "0xaabbccddeeff0011223344556677889900aabbcc",
      explorerUrl: "https://explorer.example.test/",
      deploymentBlock: "123",
      confirmations: 2,
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }
    }
  );
});

test("rejects unsupported chains and credential-bearing RPC URLs", () => {
  assert.throws(() =>
    loadChainConfiguration({
      NEXT_PUBLIC_MONAD_CHAIN_ID: "1",
      NEXT_PUBLIC_MONAD_RPC_URL: "https://rpc.example.test",
      NEXT_PUBLIC_MONAD_EXPLORER_URL: "https://explorer.example.test"
    })
  );
  assert.throws(() =>
    loadChainConfiguration({
      NEXT_PUBLIC_MONAD_CHAIN_ID: "10143",
      NEXT_PUBLIC_MONAD_RPC_URL: "https://user:secret@rpc.example.test",
      NEXT_PUBLIC_MONAD_EXPLORER_URL: "https://explorer.example.test"
    })
  );
});

test("rejects incomplete deployments, zero contracts, and insecure remote URLs", () => {
  const base = {
    NEXT_PUBLIC_MONAD_CHAIN_ID: "10143",
    NEXT_PUBLIC_MONAD_RPC_URL: "https://rpc.example.test",
    NEXT_PUBLIC_MONAD_EXPLORER_URL: "https://explorer.example.test"
  };
  assert.throws(() =>
    loadChainConfiguration({
      ...base,
      NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS: `0x${"0".repeat(40)}`,
      DONEBOND_DEPLOYMENT_BLOCK: "1"
    })
  );
  assert.throws(() =>
    loadChainConfiguration({
      ...base,
      NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS: `0x${"1".repeat(40)}`
    })
  );
  assert.throws(() =>
    loadChainConfiguration({
      ...base,
      NEXT_PUBLIC_MONAD_RPC_URL: "http://rpc.example.test"
    })
  );
});
