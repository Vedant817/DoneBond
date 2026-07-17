import { dispatchAuthRequest } from "@/server/auth-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return dispatchAuthRequest("logout", request);
}
