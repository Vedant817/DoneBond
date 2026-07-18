import { dispatchReceipt } from "@/server/receipt-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ transactionId: string }> }
): Promise<Response> {
  return dispatchReceipt("reconcileReceipt", request, (await context.params).transactionId);
}
