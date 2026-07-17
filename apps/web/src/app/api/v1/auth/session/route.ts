import { dispatchAuthRequest } from "@/server/auth-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return dispatchAuthRequest("session", request);
}
