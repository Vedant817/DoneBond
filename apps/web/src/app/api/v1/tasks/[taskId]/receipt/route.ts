import { dispatchReceipt } from "@/server/receipt-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Member-authenticated receipt read (cookie session), mirroring the
 * membership-scoped shape of `GET /api/v1/tasks/[taskId]`. Returns the same
 * allowlisted fields as the public `GET /api/v1/receipt/[receiptId]` route,
 * but requires the caller to be a project member rather than allowing anyone
 * with the opaque task ID to view it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
): Promise<Response> {
  return dispatchReceipt("getMemberReceipt", request, (await context.params).taskId);
}
