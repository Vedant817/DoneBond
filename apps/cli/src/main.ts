import {
  stdin as processStdin,
  stderr as processStderr,
  stdout as processStdout
} from "node:process";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import type { ConnectionInput } from "./config.js";
import { CliError, ExitCode, toCliError } from "./errors.js";
import { initializeRepository } from "./init.js";
import { CliOutput } from "./output.js";
import { renderPolicySummary, validatePolicyCommand } from "./policy-command.js";
import { verifyPublicReceipt } from "./receipt-command.js";
import { submitEvidence } from "./submit-command.js";
import { pullTask } from "./task-command.js";
import { verifyTask, type VerifyTaskResult } from "./verify-command.js";
import { readVersion } from "./version.js";

const HELP = `DoneBond CLI

Usage:
  donebond [--json] <command> [options]
  donebond --help
  donebond --version

Commands:
  init             Initialize DoneBond policy and optional API configuration
  policy validate  Validate and explain the deterministic verification policy
  task pull        Fetch and validate a task into the local repository
  verify           Execute policy checks and write canonical evidence
  submit           Validate and upload passing evidence to DoneBond
  receipt verify   Independently verify a public receipt against Monad

Global options:
  --json       Emit newline-delimited JSON results and errors
  -h, --help   Show help
  -v, --version Show version

Exit codes:
  0 success, 2 usage, 3 configuration, 4 repository, 5 network,
  6 conflict, 7 verification failed, 70 unexpected internal failure
`;

const INIT_HELP = `Usage: donebond init [options]

Creates .donebond/policy.yml in the discovered Git repository. API credentials
are validated and stored outside the repository with restrictive permissions.

Options:
  --repo <path>        Start repository discovery at path (default: current directory)
  --force              Replace an existing policy explicitly
  --offline            Initialize only the policy; do not configure an API connection
  --api-url <url>      DoneBond API origin (HTTPS, or HTTP on localhost)
  --project-id <id>    DoneBond project public identifier
  --token-stdin        Read the CLI token from stdin without exposing it in arguments
  -h, --help           Show this command help

Without --offline or connection options, an interactive terminal prompts for
the API URL, project ID, and a hidden token.
`;

const POLICY_VALIDATE_HELP = `Usage: donebond policy validate [options]

Validates the strict policy, prints every executable/argument/cwd/timeout, and
prints the canonical policy hash without executing any command.

Options:
  --repo <path>        Start repository discovery at path (default: current directory)
  --policy <path>      Policy path (default: <repo>/.donebond/policy.yml)
  -h, --help           Show this command help
`;

const TASK_PULL_HELP = `Usage: donebond task pull <task-id> [options]

Fetches an authenticated task, verifies its project, policy, and canonical task
commitments, then saves .donebond/task.json without modifying source files.

Options:
  --repo <path>        Start repository discovery at path (default: current directory)
  -h, --help           Show this command help
`;

const VERIFY_HELP = `Usage: donebond verify [options]

Validates the pulled task and policy, binds the exact clean Git commit, executes
each check directly without a shell, and writes evidence even when checks fail.

Options:
  --repo <path>        Start repository discovery at path (default: current directory)
  --commit <object-id> Require HEAD to equal this full Git object ID
  --output <filename>  Evidence filename inside .donebond (must end .evidence.json)
  -h, --help           Show this command help
`;

const SUBMIT_HELP = `Usage: donebond submit [options]

Validates a canonical passing evidence bundle against the local policy, task,
and exact Git commit, uploads it with retry-safe idempotency, then compares the
server commitments with the local values. This command never requests a key.

Options:
  --repo <path>        Start repository discovery at path (default: current directory)
  --bundle <filename>  Evidence file inside .donebond (default: <task-id>.evidence.json)
  -h, --help           Show this command help
`;

const RECEIPT_VERIFY_HELP = `Usage: donebond receipt verify <receipt-id> [options]

Downloads the public evidence bundle, recomputes its commitment, validates the
verifier signature, and compares the task, transaction, and ReceiptSubmitted
event with an independently selected Monad RPC endpoint.

Options:
  --api-url <url>  Public DoneBond application origin
  --rpc-url <url>  Independent Monad JSON-RPC endpoint
  -h, --help       Show this command help
`;

interface CliContext {
  stdin: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  stdout: Writable;
  stderr: Writable;
  cwd: string;
  environment: NodeJS.ProcessEnv;
  fetchImplementation: typeof fetch;
}

export interface RunCliOptions {
  stdin?: CliContext["stdin"];
  stdout?: Writable;
  stderr?: Writable;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
}

interface InitArguments {
  help: boolean;
  force: boolean;
  offline: boolean;
  repo: string;
  apiUrl?: string;
  projectId?: string;
  tokenStdin: boolean;
}

interface PolicyArguments {
  help: boolean;
  repo: string;
  policyPath?: string;
}

interface TaskPullArguments {
  help: boolean;
  repo: string;
  taskId?: string;
}

interface VerifyArguments {
  help: boolean;
  repo: string;
  commit?: string;
  output?: string;
}

interface SubmitArguments {
  help: boolean;
  repo: string;
  bundle?: string;
}

interface ReceiptVerifyArguments {
  help: boolean;
  receiptId?: string;
  apiUrl?: string;
  rpcUrl?: string;
}

function optionValue(arguments_: string[], index: number, option: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CliError("CLI_USAGE", `${option} requires a value.`, ExitCode.Usage);
  }
  return value;
}

function parseInitArguments(arguments_: string[], defaultRepository: string): InitArguments {
  const parsed: InitArguments = {
    help: false,
    force: false,
    offline: false,
    repo: defaultRepository,
    tokenStdin: false
  };
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    const canonical = argument === "-h" ? "--help" : argument;
    if (seen.has(canonical)) {
      throw new CliError(
        "CLI_USAGE",
        "An init option was provided more than once.",
        ExitCode.Usage
      );
    }
    seen.add(canonical);
    switch (canonical) {
      case "--help":
        parsed.help = true;
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--offline":
        parsed.offline = true;
        break;
      case "--token-stdin":
        parsed.tokenStdin = true;
        break;
      case "--repo":
        parsed.repo = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      case "--api-url":
        parsed.apiUrl = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      case "--project-id":
        parsed.projectId = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      default:
        throw new CliError(
          "CLI_USAGE",
          "Unknown init option. Run donebond init --help for supported options.",
          ExitCode.Usage
        );
    }
  }
  return parsed;
}

function parsePolicyArguments(arguments_: string[], defaultRepository: string): PolicyArguments {
  const parsed: PolicyArguments = { help: false, repo: defaultRepository };
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    const canonical = argument === "-h" ? "--help" : argument;
    if (seen.has(canonical)) {
      throw new CliError(
        "CLI_USAGE",
        "A policy option was provided more than once.",
        ExitCode.Usage
      );
    }
    seen.add(canonical);
    switch (canonical) {
      case "--help":
        parsed.help = true;
        break;
      case "--repo":
        parsed.repo = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      case "--policy":
        parsed.policyPath = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      default:
        throw new CliError(
          "CLI_USAGE",
          "Unknown policy option. Run donebond policy validate --help.",
          ExitCode.Usage
        );
    }
  }
  return parsed;
}

function parseTaskPullArguments(
  arguments_: string[],
  defaultRepository: string
): TaskPullArguments {
  const parsed: TaskPullArguments = { help: false, repo: defaultRepository };
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    const canonical = argument === "-h" ? "--help" : argument;
    if (!canonical.startsWith("-")) {
      if (parsed.taskId !== undefined) {
        throw new CliError("CLI_USAGE", "task pull accepts exactly one task ID.", ExitCode.Usage);
      }
      parsed.taskId = canonical;
      continue;
    }
    if (seen.has(canonical)) {
      throw new CliError("CLI_USAGE", "A task pull option was provided twice.", ExitCode.Usage);
    }
    seen.add(canonical);
    switch (canonical) {
      case "--help":
        parsed.help = true;
        break;
      case "--repo":
        parsed.repo = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      default:
        throw new CliError("CLI_USAGE", "Unknown task pull option.", ExitCode.Usage);
    }
  }
  if (!parsed.help && parsed.taskId === undefined) {
    throw new CliError("CLI_USAGE", "task pull requires a task ID.", ExitCode.Usage);
  }
  return parsed;
}

function parseVerifyArguments(arguments_: string[], defaultRepository: string): VerifyArguments {
  const parsed: VerifyArguments = { help: false, repo: defaultRepository };
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    const canonical = argument === "-h" ? "--help" : argument;
    if (seen.has(canonical)) {
      throw new CliError("CLI_USAGE", "A verify option was provided twice.", ExitCode.Usage);
    }
    seen.add(canonical);
    switch (canonical) {
      case "--help":
        parsed.help = true;
        break;
      case "--repo":
        parsed.repo = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      case "--commit":
        parsed.commit = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      case "--output":
        parsed.output = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      default:
        throw new CliError("CLI_USAGE", "Unknown verify option.", ExitCode.Usage);
    }
  }
  return parsed;
}

function parseSubmitArguments(arguments_: string[], defaultRepository: string): SubmitArguments {
  const parsed: SubmitArguments = { help: false, repo: defaultRepository };
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    const canonical = argument === "-h" ? "--help" : argument;
    if (seen.has(canonical)) {
      throw new CliError("CLI_USAGE", "A submit option was provided twice.", ExitCode.Usage);
    }
    seen.add(canonical);
    switch (canonical) {
      case "--help":
        parsed.help = true;
        break;
      case "--repo":
        parsed.repo = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      case "--bundle":
        parsed.bundle = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      default:
        throw new CliError("CLI_USAGE", "Unknown submit option.", ExitCode.Usage);
    }
  }
  return parsed;
}

function parseReceiptVerifyArguments(arguments_: string[]): ReceiptVerifyArguments {
  const parsed: ReceiptVerifyArguments = { help: false };
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    const canonical = argument === "-h" ? "--help" : argument;
    if (!canonical.startsWith("-")) {
      if (parsed.receiptId !== undefined) {
        throw new CliError(
          "CLI_USAGE",
          "receipt verify accepts exactly one receipt ID.",
          ExitCode.Usage
        );
      }
      parsed.receiptId = canonical;
      continue;
    }
    if (seen.has(canonical)) {
      throw new CliError("CLI_USAGE", "A receipt option was provided twice.", ExitCode.Usage);
    }
    seen.add(canonical);
    switch (canonical) {
      case "--help":
        parsed.help = true;
        break;
      case "--api-url":
        parsed.apiUrl = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      case "--rpc-url":
        parsed.rpcUrl = optionValue(arguments_, index, canonical);
        index += 1;
        break;
      default:
        throw new CliError("CLI_USAGE", "Unknown receipt verify option.", ExitCode.Usage);
    }
  }
  if (!parsed.help && (!parsed.receiptId || !parsed.apiUrl || !parsed.rpcUrl)) {
    throw new CliError(
      "CLI_USAGE",
      "receipt verify requires a receipt ID, --api-url, and --rpc-url.",
      ExitCode.Usage
    );
  }
  return parsed;
}

function renderVerificationResult(result: VerifyTaskResult): string {
  const lines = [
    result.passing ? "Verification passed." : "Verification failed.",
    `Commit: ${result.git.objectId}`,
    `Commit hash: ${result.git.derivedCommitHash}`,
    `Evidence: ${result.evidenceHash ?? "diagnostic-only"}`,
    `Output: ${result.outputPath}`
  ];
  if (result.failureCodes.length > 0) {
    lines.push(`Failures: ${result.failureCodes.join(", ")}`);
  }
  lines.push("Checks:");
  for (const check of result.checks) {
    lines.push(
      `  ${check.key.padEnd(20)} ${check.status.padEnd(10)} exit=${check.exitCode ?? "-"} duration=${check.durationMs}ms`
    );
  }
  return lines.join("\n");
}

async function readStdinToken(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 8192) {
      throw new CliError("CONFIG_INVALID", "CLI token input is too large.", ExitCode.Configuration);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function readHiddenToken(context: CliContext): Promise<string> {
  if (!context.stdin.isTTY || context.stdin.setRawMode === undefined) {
    throw new CliError(
      "CLI_USAGE",
      "Interactive token input requires a terminal; use --token-stdin instead.",
      ExitCode.Usage
    );
  }
  context.stderr.write("CLI token (input hidden): ");
  context.stdin.setRawMode(true);
  context.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let token = "";
    const cleanup = (): void => {
      context.stdin.off("data", onData);
      context.stdin.setRawMode?.(false);
      context.stdin.pause();
      context.stderr.write("\n");
    };
    const onData = (chunk: Buffer | string): void => {
      const text = chunk.toString();
      for (const character of text) {
        if (character === "\u0003") {
          cleanup();
          reject(new CliError("CLI_USAGE", "Input cancelled.", ExitCode.Usage));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(token);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          token = token.slice(0, -1);
        } else if (token.length < 8192) {
          token += character;
        }
      }
    };
    context.stdin.on("data", onData);
  });
}

async function promptConnection(context: CliContext): Promise<ConnectionInput> {
  if (!context.stdin.isTTY) {
    throw new CliError(
      "CLI_USAGE",
      "Connection values are required in non-interactive mode; use --offline or provide API options.",
      ExitCode.Usage
    );
  }
  const prompt = createInterface({ input: context.stdin, output: context.stderr, terminal: true });
  let apiUrl: string;
  let projectId: string;
  try {
    apiUrl = (await prompt.question("API URL: ")).trim();
    projectId = (await prompt.question("Project ID: ")).trim();
  } finally {
    prompt.close();
  }
  const token = await readHiddenToken(context);
  return { apiUrl, projectId, token };
}

async function resolveConnection(
  arguments_: InitArguments,
  context: CliContext
): Promise<ConnectionInput | undefined> {
  const hasConnectionOption =
    arguments_.apiUrl !== undefined || arguments_.projectId !== undefined || arguments_.tokenStdin;
  if (arguments_.offline) {
    if (hasConnectionOption) {
      throw new CliError(
        "CLI_USAGE",
        "--offline cannot be combined with API connection options.",
        ExitCode.Usage
      );
    }
    return undefined;
  }
  if (!hasConnectionOption) {
    return promptConnection(context);
  }
  if (
    arguments_.apiUrl === undefined ||
    arguments_.projectId === undefined ||
    !arguments_.tokenStdin
  ) {
    throw new CliError(
      "CLI_USAGE",
      "--api-url, --project-id, and --token-stdin must be provided together.",
      ExitCode.Usage
    );
  }
  return {
    apiUrl: arguments_.apiUrl,
    projectId: arguments_.projectId,
    token: await readStdinToken(context.stdin)
  };
}

async function execute(
  arguments_: string[],
  context: CliContext,
  output: CliOutput
): Promise<ExitCode> {
  const filtered = arguments_.filter((argument) => argument !== "--json");
  if (filtered.length === 0 || filtered[0] === "--help" || filtered[0] === "-h") {
    output.result(HELP.trimEnd());
    return ExitCode.Success;
  }
  if (filtered[0] === "--version" || filtered[0] === "-v") {
    if (filtered.length !== 1) {
      throw new CliError("CLI_USAGE", "--version does not accept arguments.", ExitCode.Usage);
    }
    const version = await readVersion();
    output.result(version, { version });
    return ExitCode.Success;
  }
  if (filtered[0] === "policy") {
    if (filtered[1] !== "validate") {
      throw new CliError(
        "CLI_USAGE",
        "Unknown policy command. Run donebond policy validate --help.",
        ExitCode.Usage
      );
    }
    const policyArguments = parsePolicyArguments(filtered.slice(2), context.cwd);
    if (policyArguments.help) {
      output.result(POLICY_VALIDATE_HELP.trimEnd());
      return ExitCode.Success;
    }
    const summary = await validatePolicyCommand({
      startDirectory: policyArguments.repo,
      ...(policyArguments.policyPath === undefined
        ? {}
        : { policyPath: policyArguments.policyPath })
    });
    output.result(renderPolicySummary(summary), {
      repositoryRoot: summary.repositoryRoot,
      policyPath: summary.policyPath,
      policyHash: summary.policyHash,
      checks: summary.checks
    });
    return ExitCode.Success;
  }
  if (filtered[0] === "task") {
    if (filtered[1] !== "pull") {
      throw new CliError(
        "CLI_USAGE",
        "Unknown task command. Run donebond task pull --help.",
        ExitCode.Usage
      );
    }
    const taskArguments = parseTaskPullArguments(filtered.slice(2), context.cwd);
    if (taskArguments.help) {
      output.result(TASK_PULL_HELP.trimEnd());
      return ExitCode.Success;
    }
    const result = await pullTask({
      startDirectory: taskArguments.repo,
      taskId: taskArguments.taskId as string,
      environment: context.environment,
      fetchImplementation: context.fetchImplementation
    });
    output.result("DoneBond task pulled and verified.", {
      taskId: result.task.publicId,
      projectId: result.task.projectPublicId,
      taskHash: result.task.taskHash,
      policyHash: result.task.policyHash,
      manifestPath: result.manifestPath
    });
    return ExitCode.Success;
  }
  if (filtered[0] === "verify") {
    const verifyArguments = parseVerifyArguments(filtered.slice(1), context.cwd);
    if (verifyArguments.help) {
      output.result(VERIFY_HELP.trimEnd());
      return ExitCode.Success;
    }
    const json = arguments_.includes("--json");
    const result = await verifyTask({
      startDirectory: verifyArguments.repo,
      ...(verifyArguments.commit === undefined ? {} : { expectedCommit: verifyArguments.commit }),
      ...(verifyArguments.output === undefined ? {} : { outputPath: verifyArguments.output }),
      environment: context.environment,
      onProgress: (event) => {
        const humanProgress =
          event.type === "check-started"
            ? `Running ${event.key}\n  executable: ${JSON.stringify(event.executable)}\n  args: ${JSON.stringify(event.args)}\n  cwd: ${event.cwd}\n  timeout: ${event.timeoutSeconds}s\n  environment: ${event.environmentNames.join(", ") || "none"}`
            : `Finished ${event.key}: ${event.status}`;
        context.stderr.write(json ? `${JSON.stringify(event)}\n` : `${humanProgress}\n`);
      }
    });
    output.result(renderVerificationResult(result), {
      passing: result.passing,
      diagnosticOnly: result.diagnosticOnly,
      taskId: result.task.publicId,
      commit: result.git.objectId,
      commitHash: result.git.derivedCommitHash,
      outputPath: result.outputPath,
      ...(result.evidenceHash === undefined ? {} : { evidenceHash: result.evidenceHash }),
      failureCodes: result.failureCodes,
      checks: result.checks.map((check) => ({
        key: check.key,
        required: check.required,
        status: check.status,
        durationMs: check.durationMs,
        exitCode: check.exitCode
      }))
    });
    return result.passing ? ExitCode.Success : ExitCode.Verification;
  }
  if (filtered[0] === "submit") {
    const submitArguments = parseSubmitArguments(filtered.slice(1), context.cwd);
    if (submitArguments.help) {
      output.result(SUBMIT_HELP.trimEnd());
      return ExitCode.Success;
    }
    const result = await submitEvidence({
      startDirectory: submitArguments.repo,
      ...(submitArguments.bundle === undefined ? {} : { bundlePath: submitArguments.bundle }),
      environment: context.environment,
      fetchImplementation: context.fetchImplementation
    });
    output.result(
      `Evidence submitted.\nEvidence: ${result.evidenceHash}\nPublic bundle: ${result.publicEvidenceUrl}\nSubmit the receipt with your wallet: ${result.taskUrl}`,
      {
        evidencePublicId: result.evidencePublicId,
        taskPublicId: result.taskPublicId,
        evidenceHash: result.evidenceHash,
        commitHash: result.commitHash,
        publicEvidenceUrl: result.publicEvidenceUrl,
        taskUrl: result.taskUrl
      }
    );
    return ExitCode.Success;
  }
  if (filtered[0] === "receipt") {
    if (filtered[1] !== "verify") {
      throw new CliError(
        "CLI_USAGE",
        "Unknown receipt command. Run donebond receipt verify --help.",
        ExitCode.Usage
      );
    }
    const receiptArguments = parseReceiptVerifyArguments(filtered.slice(2));
    if (receiptArguments.help) {
      output.result(RECEIPT_VERIFY_HELP.trimEnd());
      return ExitCode.Success;
    }
    const result = await verifyPublicReceipt({
      receiptId: receiptArguments.receiptId as string,
      apiUrl: receiptArguments.apiUrl as string,
      rpcUrl: receiptArguments.rpcUrl as string,
      fetchImplementation: context.fetchImplementation
    });
    output.result(
      `Receipt independently verified.\nEvidence: ${result.evidenceHash}\nTransaction: ${result.transactionHash}\nVerifier: ${result.verifierAddress}`,
      {
        verified: true,
        receiptId: result.receiptId,
        evidencePublicId: result.evidencePublicId,
        evidenceHash: result.evidenceHash,
        commitHash: result.commitHash,
        transactionHash: result.transactionHash,
        chainId: result.chainId,
        contractAddress: result.contractAddress,
        verifierAddress: result.verifierAddress
      }
    );
    return ExitCode.Success;
  }
  if (filtered[0] !== "init") {
    throw new CliError(
      "CLI_USAGE",
      "Unknown command. Run donebond --help for supported commands.",
      ExitCode.Usage
    );
  }
  const initArguments = parseInitArguments(filtered.slice(1), context.cwd);
  if (initArguments.help) {
    output.result(INIT_HELP.trimEnd());
    return ExitCode.Success;
  }
  const connection = await resolveConnection(initArguments, context);
  const result = await initializeRepository({
    startDirectory: initArguments.repo,
    force: initArguments.force,
    ...(connection === undefined ? {} : { connection }),
    environment: context.environment,
    fetchImplementation: context.fetchImplementation
  });
  output.result("DoneBond repository initialized.", {
    repositoryRoot: result.repositoryRoot,
    policyPath: result.policyPath,
    policyCreated: result.policyCreated,
    connectionConfigured: result.connectionConfigured,
    ...(result.configPath === undefined ? {} : { configPath: result.configPath })
  });
  return ExitCode.Success;
}

export async function runCli(arguments_: string[], options: RunCliOptions = {}): Promise<ExitCode> {
  const context: CliContext = {
    stdin: options.stdin ?? processStdin,
    stdout: options.stdout ?? processStdout,
    stderr: options.stderr ?? processStderr,
    cwd: options.cwd ?? process.cwd(),
    environment: options.environment ?? process.env,
    fetchImplementation: options.fetchImplementation ?? fetch
  };
  const output = new CliOutput(arguments_.includes("--json"), {
    stdout: context.stdout,
    stderr: context.stderr
  });
  try {
    return await execute(arguments_, context, output);
  } catch (error) {
    const cliError = toCliError(error);
    output.error(cliError);
    return cliError.exitCode;
  }
}
