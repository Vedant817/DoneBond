import { realpath } from "node:fs/promises";
import path from "node:path";

import { EvidenceError } from "./errors.js";

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function resolveRepositoryPath(repositoryRoot: string, relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    throw new EvidenceError(
      "POLICY_PATH_OUTSIDE_REPOSITORY",
      `Working directory ${JSON.stringify(relativePath)} must be repository-relative`
    );
  }
  const root = path.resolve(repositoryRoot);
  const candidate = path.resolve(root, relativePath);
  if (!isInside(root, candidate)) {
    throw new EvidenceError(
      "POLICY_PATH_OUTSIDE_REPOSITORY",
      `Working directory ${JSON.stringify(relativePath)} escapes the repository`
    );
  }
  return candidate;
}

export async function resolveExistingRepositoryPath(
  repositoryRoot: string,
  relativePath: string
): Promise<string> {
  const lexical = resolveRepositoryPath(repositoryRoot, relativePath);
  let rootReal: string;
  let candidateReal: string;
  try {
    [rootReal, candidateReal] = await Promise.all([realpath(repositoryRoot), realpath(lexical)]);
  } catch (cause) {
    throw new EvidenceError(
      "POLICY_PATH_OUTSIDE_REPOSITORY",
      `Working directory ${JSON.stringify(relativePath)} does not exist`,
      { cause }
    );
  }
  if (!isInside(rootReal, candidateReal)) {
    throw new EvidenceError(
      "POLICY_PATH_OUTSIDE_REPOSITORY",
      `Working directory ${JSON.stringify(relativePath)} resolves outside the repository`
    );
  }
  return candidateReal;
}
