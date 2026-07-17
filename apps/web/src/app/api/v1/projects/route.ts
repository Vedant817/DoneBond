import { dispatchProjectPolicy } from "@/server/project-policy-runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return dispatchProjectPolicy("listProjects", request);
}

export async function POST(request: Request): Promise<Response> {
  return dispatchProjectPolicy("createProject", request);
}
