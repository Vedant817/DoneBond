import { dispatchEvidence } from "@/server/evidence-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; taskId: string }> }
): Promise<Response> {
  const { projectId, taskId } = await context.params;
  return dispatchEvidence("listEvidence", request, projectId, taskId);
}
