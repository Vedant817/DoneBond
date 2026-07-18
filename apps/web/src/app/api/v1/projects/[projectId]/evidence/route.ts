import { dispatchEvidence } from "@/server/evidence-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  return dispatchEvidence("submit", request, (await context.params).projectId);
}
