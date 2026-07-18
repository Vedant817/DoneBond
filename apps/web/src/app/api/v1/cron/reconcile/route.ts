import { isAuthorizedCronRequest } from "../../../../../server/cron-auth.ts";
import { runConfiguredReconciliationJob } from "../../../../../server/reconciliation-job.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }
  try {
    const reconciliation = await runConfiguredReconciliationJob();
    return Response.json(
      { ok: true, reconciliation, checkedAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return Response.json(
      { ok: false, error: { code: "RECONCILIATION_FAILED", message: "Reconciliation failed" } },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
