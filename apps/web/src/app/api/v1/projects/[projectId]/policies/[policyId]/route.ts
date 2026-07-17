import { dispatchProjectPolicy } from "@/server/project-policy-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; policyId: string }> }
): Promise<Response> {
  const { projectId, policyId } = await context.params;
  return dispatchProjectPolicy("getPolicy", request, projectId, policyId);
}
