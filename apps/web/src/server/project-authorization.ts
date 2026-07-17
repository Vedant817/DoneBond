import { ERROR_CODES, PublicIdentifierSchema } from "@donebond/shared";

import { HttpError } from "./http.ts";
import type { AuthenticatedSession } from "./wallet-auth.ts";

export type ProjectRole = "owner" | "member";
const PROJECT_PUBLIC_ID = /^[0-9a-hjkmnp-tv-z]{26}$/u;

export interface ProjectAccess {
  readonly projectPublicId: string;
  readonly role: ProjectRole;
}

export interface ProjectAccessStore {
  findProjectAccess(projectPublicId: string, userId: string): Promise<ProjectAccess | null>;
}

export interface SessionAuthenticator {
  authenticate(cookieHeader: string | null): Promise<AuthenticatedSession>;
}

export async function authorizeProjectSession(
  accessStore: ProjectAccessStore,
  session: AuthenticatedSession,
  projectPublicIdInput: string,
  requiredRole: ProjectRole = "member"
): Promise<ProjectAccess> {
  if (requiredRole !== "member" && requiredRole !== "owner") {
    throw new HttpError(ERROR_CODES.AUTH_FORBIDDEN, "Project access requirement is invalid", 403);
  }
  let projectPublicId: string;
  try {
    projectPublicId = PublicIdentifierSchema.parse(projectPublicIdInput);
    if (!PROJECT_PUBLIC_ID.test(projectPublicId)) throw new TypeError("Invalid project ID");
  } catch {
    throw new HttpError(ERROR_CODES.PROJECT_NOT_FOUND, "Project was not found", 404);
  }
  const access = await accessStore.findProjectAccess(projectPublicId, session.userId);
  if (access === null || access.projectPublicId !== projectPublicId) {
    throw new HttpError(ERROR_CODES.PROJECT_NOT_FOUND, "Project was not found", 404);
  }
  if (requiredRole === "owner" && access.role !== "owner") {
    throw new HttpError(ERROR_CODES.AUTH_FORBIDDEN, "Project owner access is required", 403);
  }
  return access;
}

export async function requireProjectAccess(
  authenticator: SessionAuthenticator,
  accessStore: ProjectAccessStore,
  cookieHeader: string | null,
  projectPublicIdInput: string,
  requiredRole: ProjectRole = "member"
): Promise<{ session: AuthenticatedSession; access: ProjectAccess }> {
  const session = await authenticator.authenticate(cookieHeader);
  const access = await authorizeProjectSession(
    accessStore,
    session,
    projectPublicIdInput,
    requiredRole
  );
  return { session, access };
}
