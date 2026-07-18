import { checkDatabaseHealth } from "@donebond/db";
import { loadChainConfiguration } from "@donebond/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function rpcHealth(rpcUrl: string, expectedChainId: number): Promise<boolean> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) return false;
  const body = (await response.json()) as { result?: unknown };
  return typeof body.result === "string" && Number.parseInt(body.result, 16) === expectedChainId;
}

export async function GET(): Promise<Response> {
  const checkedAt = new Date().toISOString();
  try {
    const chain = loadChainConfiguration(process.env);
    if (!chain.rpcUrl) throw new TypeError("RPC is not configured");
    const [database, rpc] = await Promise.allSettled([
      checkDatabaseHealth(),
      rpcHealth(chain.rpcUrl, chain.chainId)
    ]);
    const status = {
      database: database.status === "fulfilled" && database.value,
      rpc: rpc.status === "fulfilled" && rpc.value
    };
    const healthy = status.database && status.rpc;
    return Response.json(
      { status: healthy ? "healthy" : "degraded", dependencies: status, checkedAt },
      { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } }
    );
  } catch {
    return Response.json(
      {
        status: "degraded",
        dependencies: { database: false, rpc: false },
        checkedAt
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
