import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

import type { CheckResult, PolicyCheck, VerificationPolicy } from "@donebond/shared";

import { EvidenceError } from "./errors.js";
import { resolveExistingRepositoryPath } from "./path-safety.js";
import { createBoundedOutput } from "./redaction.js";

const PUBLIC_PREVIEW_LIMIT = 262_144;
const ABSOLUTE_CAPTURE_LIMIT = 16 * 1024 * 1024;

export type RunnerProgress =
  | {
      readonly type: "check-started";
      readonly key: string;
      readonly label: string;
      readonly executable: string;
      readonly args: readonly string[];
      readonly cwd: string;
      readonly timeoutSeconds: number;
      readonly environmentNames: readonly string[];
    }
  | {
      readonly type: "check-finished";
      readonly key: string;
      readonly status: CheckResult["status"];
    };

export interface RunCheckOptions {
  readonly repositoryRoot: string;
  readonly globalEnvironmentAllowlist: readonly string[];
  readonly additionalRedactionPatterns?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly onProgress?: (event: RunnerProgress) => void;
}

interface CapturedStream {
  readonly chunks: Buffer[];
  bytes: number;
  retainedBytes: number;
  exceeded: boolean;
}

export interface ExecutedCheckResult extends CheckResult {
  readonly endedAt: string;
}

function terminateProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited between observation and termination.
    }
  }
}

function createEnvironment(
  globalAllowlist: readonly string[],
  checkAllowlist: readonly string[],
  source: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const selected = checkAllowlist.length === 0 ? globalAllowlist : checkAllowlist;
  const allowed = new Set(globalAllowlist);
  const environment: Record<string, string | undefined> = {};
  for (const key of selected) {
    if (!allowed.has(key)) {
      throw new EvidenceError(
        "POLICY_INVALID",
        `Check environment variable ${key} is outside the global allowlist`
      );
    }
    const value = source[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}

function appendChunk(
  stream: CapturedStream,
  chunk: Buffer,
  hardLimit: number,
  child: ChildProcess
): void {
  stream.bytes += chunk.byteLength;
  if (stream.exceeded) {
    return;
  }
  const remaining = hardLimit - stream.retainedBytes;
  if (remaining > 0) {
    const retained = chunk.subarray(0, remaining);
    stream.chunks.push(retained);
    stream.retainedBytes += retained.byteLength;
  }
  if (chunk.byteLength > remaining) {
    stream.exceeded = true;
    terminateProcessGroup(child, "SIGTERM");
    const force = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 250);
    force.unref();
  }
}

function mergeCounts(
  ...counts: ReadonlyArray<Readonly<Record<string, number>>>
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const record of counts) {
    for (const [key, value] of Object.entries(record)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

export async function runCheck(
  check: PolicyCheck,
  options: RunCheckOptions
): Promise<ExecutedCheckResult> {
  const workingDirectory = await resolveExistingRepositoryPath(options.repositoryRoot, check.cwd);
  const environment = createEnvironment(
    options.globalEnvironmentAllowlist,
    check.environmentAllowlist,
    options.environment ?? process.env
  );
  const hardLimit = Math.min(
    ABSOLUTE_CAPTURE_LIMIT,
    Math.max(1024 * 1024, check.maxOutputBytes * 16)
  );
  const stdout: CapturedStream = { chunks: [], bytes: 0, retainedBytes: 0, exceeded: false };
  const stderr: CapturedStream = { chunks: [], bytes: 0, retainedBytes: 0, exceeded: false };
  const startedAt = new Date().toISOString();
  const start = performance.now();
  options.onProgress?.({
    type: "check-started",
    key: check.key,
    label: check.label,
    executable: check.executable,
    args: check.args,
    cwd: check.cwd,
    timeoutSeconds: check.timeoutSeconds,
    environmentNames:
      check.environmentAllowlist.length === 0
        ? options.globalEnvironmentAllowlist
        : check.environmentAllowlist
  });

  let spawnError: Error | undefined;
  let timedOut = false;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;

  await new Promise<void>((resolve) => {
    const child = spawn(check.executable, check.args, {
      cwd: workingDirectory,
      detached: process.platform !== "win32",
      // Next.js makes NODE_ENV mandatory in its ambient ProcessEnv declaration,
      // while the evidence sandbox intentionally omits every non-allowlisted key.
      env: environment as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    child.stdout?.on("data", (chunk: Buffer) => appendChunk(stdout, chunk, hardLimit, child));
    child.stderr?.on("data", (chunk: Buffer) => appendChunk(stderr, chunk, hardLimit, child));
    child.once("error", (error) => {
      spawnError = error;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessGroup(child, "SIGTERM");
      const force = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 250);
      force.unref();
    }, check.timeoutSeconds * 1000);
    timeout.unref();
    child.once("close", (code, closeSignal) => {
      clearTimeout(timeout);
      exitCode = code;
      signal = closeSignal;
      resolve();
    });
  });

  const durationMs = Math.max(0, Math.round(performance.now() - start));
  const outputLimitExceeded = stdout.exceeded || stderr.exceeded;
  const status: CheckResult["status"] = timedOut
    ? "timed_out"
    : spawnError !== undefined || outputLimitExceeded
      ? "error"
      : exitCode === 0
        ? "passed"
        : "failed";
  const maximumPreviewBytes = Math.min(PUBLIC_PREVIEW_LIMIT, check.maxOutputBytes);
  const redactionPatterns = options.additionalRedactionPatterns ?? [];
  const stdoutOutput = createBoundedOutput(
    Buffer.concat(stdout.chunks),
    maximumPreviewBytes,
    redactionPatterns,
    stdout.bytes
  );
  const stderrBytes = Buffer.concat(stderr.chunks);
  const diagnostic =
    spawnError === undefined
      ? stderrBytes
      : Buffer.concat([stderrBytes, Buffer.from("\n[PROCESS ERROR: executable unavailable]\n")]);
  const stderrOutput = createBoundedOutput(
    diagnostic,
    maximumPreviewBytes,
    redactionPatterns,
    stderr.bytes + (diagnostic.byteLength - stderrBytes.byteLength)
  );
  const endedAt = new Date().toISOString();
  const result = {
    key: check.key,
    label: check.label,
    required: check.required,
    status,
    startedAt,
    durationMs,
    exitCode: status === "passed" || status === "failed" ? exitCode : null,
    signal,
    stdout: {
      preview: stdoutOutput.preview,
      digest: stdoutOutput.digest,
      originalBytes: stdoutOutput.originalBytes,
      truncated: stdoutOutput.truncated
    },
    stderr: {
      preview: stderrOutput.preview,
      digest: stderrOutput.digest,
      originalBytes: stderrOutput.originalBytes,
      truncated: stderrOutput.truncated
    },
    endedAt
  } satisfies ExecutedCheckResult;
  options.onProgress?.({ type: "check-finished", key: check.key, status });
  Object.defineProperty(result, "redactionCounts", {
    value: mergeCounts(stdoutOutput.redactions, stderrOutput.redactions),
    enumerable: false
  });
  Object.defineProperty(result, "endedAt", { value: endedAt, enumerable: false });
  return result;
}

export function getCheckRedactionCounts(result: CheckResult): Readonly<Record<string, number>> {
  const hidden = result as CheckResult & {
    readonly redactionCounts?: Readonly<Record<string, number>>;
  };
  return hidden.redactionCounts ?? {};
}

export async function runChecksSequentially(
  policy: VerificationPolicy,
  options: Omit<RunCheckOptions, "globalEnvironmentAllowlist" | "additionalRedactionPatterns">
): Promise<readonly ExecutedCheckResult[]> {
  const results: ExecutedCheckResult[] = [];
  for (const check of policy.checks) {
    results.push(
      await runCheck(check, {
        ...options,
        globalEnvironmentAllowlist: policy.environment.allow,
        additionalRedactionPatterns: policy.redaction.additionalPatterns
      })
    );
  }
  return results;
}
