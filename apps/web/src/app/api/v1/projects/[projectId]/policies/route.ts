import { dispatchProjectPolicy } from "@/server/project-policy-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await context.params;
  return dispatchProjectPolicy("listPolicies", request, projectId);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await context.params;
  return dispatchProjectPolicy("savePolicy", request, projectId);
}
