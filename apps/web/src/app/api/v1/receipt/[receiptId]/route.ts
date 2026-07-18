import { dispatchReceipt } from "@/server/receipt-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, no-login receipt read (mirrors the `GET /api/v1/evidence/[evidenceId]`
 * precedent from milestone 4.6). `receiptId` is the task's own opaque public
 * ID: a task has at most one confirmed receipt, so no separate receipt
 * identifier is minted or stored — the task's already-unguessable ULID
 * serves as the receipt's stable public ID too.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ receiptId: string }> }
): Promise<Response> {
  return dispatchReceipt("getPublicReceipt", request, (await context.params).receiptId);
}
