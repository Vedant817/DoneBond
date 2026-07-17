import { dispatchTask } from "@/server/task-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  return dispatchTask("createTask", request, (await context.params).projectId);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  return dispatchTask("listTasks", request, (await context.params).projectId);
}
