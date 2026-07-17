import { z } from "zod";

import { DecimalWeiSchema, EthereumAddressSchema } from "./primitives.js";

export const SUPPORTED_CHAIN_IDS = [143, 10_143] as const;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

const OptionalAddressSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  EthereumAddressSchema.refine(
    (value) => value !== ZERO_ADDRESS,
    "Contract address cannot be zero"
  ).optional()
);

const OptionalDecimalSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  DecimalWeiSchema.optional()
);

const OptionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional()
);

const ChainEnvironmentSchema = z
  .strictObject({
    MONAD_RPC_URL: OptionalUrlSchema,
    NEXT_PUBLIC_MONAD_CHAIN_ID: z.coerce
      .number()
      .int()
      .refine((value) =>
        SUPPORTED_CHAIN_IDS.includes(value as (typeof SUPPORTED_CHAIN_IDS)[number])
      ),
    NEXT_PUBLIC_MONAD_RPC_URL: OptionalUrlSchema,
    NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS: OptionalAddressSchema,
    NEXT_PUBLIC_MONAD_EXPLORER_URL: z.url(),
    DONEBOND_DEPLOYMENT_BLOCK: OptionalDecimalSchema,
    DONEBOND_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(2)
  })
  .superRefine((value, context) => {
    if (!value.MONAD_RPC_URL && !value.NEXT_PUBLIC_MONAD_RPC_URL) {
      context.addIssue({
        code: "custom",
        message: "A server or public Monad RPC URL is required",
        path: ["MONAD_RPC_URL"]
      });
    }
    const hasContract = Boolean(value.NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS);
    const hasDeploymentBlock = Boolean(value.DONEBOND_DEPLOYMENT_BLOCK);
    if (hasContract !== hasDeploymentBlock) {
      context.addIssue({
        code: "custom",
        message: "Contract address and deployment block must be configured together",
        path: ["NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS"]
      });
    }
  });

export interface ChainConfiguration {
  readonly chainId: (typeof SUPPORTED_CHAIN_IDS)[number];
  readonly name: "Monad Mainnet" | "Monad Testnet";
  readonly rpcUrl: string;
  readonly publicRpcUrl?: string;
  readonly explorerUrl: string;
  readonly nativeCurrency: Readonly<{ name: "MON"; symbol: "MON"; decimals: 18 }>;
  readonly contractAddress?: string;
  readonly deploymentBlock?: string;
  readonly confirmations: number;
}

function assertSafeUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new TypeError(`${label} must not contain embedded credentials`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new TypeError(`${label} must use HTTPS outside explicit local development`);
  }
  return url.toString();
}

export function loadChainConfiguration(
  environment: Readonly<Record<string, string | undefined>>
): ChainConfiguration {
  const parsed = ChainEnvironmentSchema.parse({
    MONAD_RPC_URL: environment.MONAD_RPC_URL,
    NEXT_PUBLIC_MONAD_CHAIN_ID: environment.NEXT_PUBLIC_MONAD_CHAIN_ID,
    NEXT_PUBLIC_MONAD_RPC_URL: environment.NEXT_PUBLIC_MONAD_RPC_URL,
    NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS: environment.NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS,
    NEXT_PUBLIC_MONAD_EXPLORER_URL: environment.NEXT_PUBLIC_MONAD_EXPLORER_URL,
    DONEBOND_DEPLOYMENT_BLOCK: environment.DONEBOND_DEPLOYMENT_BLOCK,
    DONEBOND_CONFIRMATIONS: environment.DONEBOND_CONFIRMATIONS
  });

  const selectedRpcUrl = parsed.MONAD_RPC_URL ?? parsed.NEXT_PUBLIC_MONAD_RPC_URL;
  if (!selectedRpcUrl) {
    throw new TypeError("Monad RPC URL is required");
  }

  return {
    chainId: parsed.NEXT_PUBLIC_MONAD_CHAIN_ID as ChainConfiguration["chainId"],
    name: parsed.NEXT_PUBLIC_MONAD_CHAIN_ID === 143 ? "Monad Mainnet" : "Monad Testnet",
    rpcUrl: assertSafeUrl(selectedRpcUrl, "Monad RPC URL"),
    ...(parsed.NEXT_PUBLIC_MONAD_RPC_URL
      ? { publicRpcUrl: assertSafeUrl(parsed.NEXT_PUBLIC_MONAD_RPC_URL, "Public Monad RPC URL") }
      : {}),
    explorerUrl: assertSafeUrl(parsed.NEXT_PUBLIC_MONAD_EXPLORER_URL, "Monad explorer URL"),
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    ...(parsed.NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS
      ? { contractAddress: parsed.NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS }
      : {}),
    ...(parsed.DONEBOND_DEPLOYMENT_BLOCK
      ? { deploymentBlock: parsed.DONEBOND_DEPLOYMENT_BLOCK }
      : {}),
    confirmations: parsed.DONEBOND_CONFIRMATIONS
  };
}

export function toPublicChainConfiguration(configuration: ChainConfiguration) {
  return {
    chainId: configuration.chainId,
    name: configuration.name,
    ...(configuration.publicRpcUrl ? { rpcUrl: configuration.publicRpcUrl } : {}),
    explorerUrl: configuration.explorerUrl,
    nativeCurrency: configuration.nativeCurrency,
    ...(configuration.contractAddress ? { contractAddress: configuration.contractAddress } : {})
  } as const;
}
