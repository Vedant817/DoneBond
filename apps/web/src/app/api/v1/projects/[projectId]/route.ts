import { dispatchProjectPolicy } from "@/server/project-policy-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await context.params;
  return dispatchProjectPolicy("getProject", request, projectId);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await context.params;
  return dispatchProjectPolicy("updateProject", request, projectId);
}
