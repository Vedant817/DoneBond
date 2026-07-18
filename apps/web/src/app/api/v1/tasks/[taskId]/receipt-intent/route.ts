import { dispatchReceipt } from "@/server/receipt-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
): Promise<Response> {
  return dispatchReceipt("createReceiptIntent", request, (await context.params).taskId);
}
