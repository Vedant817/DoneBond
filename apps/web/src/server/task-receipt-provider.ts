import { createPublicClient, http, TransactionReceiptNotFoundError } from "viem";

import type { ChainReceipt, TaskReceiptProvider } from "./task-reconciliation.ts";

type ReceiptClient = Readonly<{
  getTransactionReceipt(input: { readonly hash: `0x${string}` }): Promise<{
    readonly status: "success" | "reverted";
    readonly transactionHash: `0x${string}`;
    readonly blockHash: `0x${string}`;
    readonly blockNumber: bigint;
    readonly logs: readonly {
      readonly address: `0x${string}`;
      readonly logIndex: number | null;
      readonly data: `0x${string}`;
      readonly topics: readonly (`0x${string}` | null)[];
    }[];
  }>;
}>;

export class MonadTaskReceiptProvider implements TaskReceiptProvider {
  readonly #chainId: number;
  readonly #client: ReceiptClient;

  constructor(chainId: number, rpcUrl: string, client?: ReceiptClient) {
    this.#chainId = chainId;
    this.#client =
      client ??
      (createPublicClient({
        transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 })
      }) as ReceiptClient);
  }

  async getReceipt(chainId: number, transactionHash: `0x${string}`): Promise<ChainReceipt | null> {
    if (chainId !== this.#chainId) throw new TypeError("Receipt chain does not match the provider");
    try {
      const receipt = await this.#client.getTransactionReceipt({ hash: transactionHash });
      return {
        status: receipt.status,
        transactionHash: receipt.transactionHash,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber,
        logs: receipt.logs.map((log) => {
          if (log.logIndex === null || log.topics.some((topic) => topic === null)) {
            throw new TypeError("Confirmed receipt contains an incomplete log");
          }
          return {
            address: log.address,
            logIndex: log.logIndex,
            data: log.data,
            topics: log.topics as readonly `0x${string}`[]
          };
        })
      };
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  }
}
