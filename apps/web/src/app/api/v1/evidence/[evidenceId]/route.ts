import { dispatchEvidence } from "@/server/evidence-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ evidenceId: string }> }
): Promise<Response> {
  return dispatchEvidence("getEvidence", request, (await context.params).evidenceId);
}
