import { dispatchTask } from "@/server/task-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ transactionId: string }> }
): Promise<Response> {
  return dispatchTask("reconcileTransaction", request, (await context.params).transactionId);
}
