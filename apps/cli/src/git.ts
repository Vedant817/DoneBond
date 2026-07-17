import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { CliError, ExitCode } from "./errors.js";

const execFileAsync = promisify(execFile);

export async function discoverRepository(startDirectory: string): Promise<string> {
  let output: string;
  try {
    const result = await execFileAsync(
      "git",
      ["-C", startDirectory, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", timeout: 10_000, windowsHide: true }
    );
    output = result.stdout;
  } catch (error) {
    throw new CliError(
      "REPOSITORY_NOT_FOUND",
      "The selected directory is not inside a Git repository.",
      ExitCode.Repository,
      { cause: error }
    );
  }

  const root = output.trim();
  if (root.length === 0) {
    throw new CliError(
      "REPOSITORY_NOT_FOUND",
      "Git did not return a repository root.",
      ExitCode.Repository
    );
  }
  return realpath(root);
}
