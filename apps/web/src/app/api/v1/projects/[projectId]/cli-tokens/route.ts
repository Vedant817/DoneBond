import { dispatchCliTokenCreate } from "@/server/cli-token-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await context.params;
  return dispatchCliTokenCreate(request, projectId);
}
