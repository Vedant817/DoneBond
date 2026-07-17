import { dispatchCliTokenRevoke } from "@/server/cli-token-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string; tokenId: string }> }
): Promise<Response> {
  const { projectId, tokenId } = await context.params;
  return dispatchCliTokenRevoke(request, projectId, tokenId);
}
