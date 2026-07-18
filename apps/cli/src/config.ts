import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { PublicIdentifierSchema } from "@donebond/shared";

import { CliError, ExitCode } from "./errors.js";

export interface ConnectionInput {
  apiUrl: string;
  projectId: string;
  token: string;
}

interface StoredConnection {
  schemaVersion: 1;
  apiUrl: string;
  projectId: string;
  repositoryFingerprint: string;
}

interface StoredCredential {
  schemaVersion: 1;
  token: string;
}

const MAX_CONNECTION_RESPONSE_BYTES = 64 * 1024;

export function normalizeConnection(input: ConnectionInput): ConnectionInput {
  let url: URL;
  try {
    url = new URL(input.apiUrl);
  } catch (error) {
    throw new CliError("CONFIG_INVALID", "API URL must be a valid URL.", ExitCode.Configuration, {
      cause: error
    });
  }
  if (url.username !== "" || url.password !== "") {
    throw new CliError(
      "CONFIG_INVALID",
      "API URL must not contain embedded credentials.",
      ExitCode.Configuration
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new CliError(
      "CONFIG_INVALID",
      "API URL must not contain a query string or fragment.",
      ExitCode.Configuration
    );
  }
  const localHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new CliError(
      "CONFIG_INVALID",
      "API URL must use HTTPS (HTTP is allowed only for localhost).",
      ExitCode.Configuration
    );
  }
  let projectId: string;
  try {
    projectId = PublicIdentifierSchema.parse(input.projectId);
  } catch {
    throw new CliError(
      "CONFIG_INVALID",
      "Project ID must be normalized lowercase ASCII with no surrounding whitespace.",
      ExitCode.Configuration
    );
  }
  if (input.token.length < 24 || /\s/.test(input.token)) {
    throw new CliError(
      "CONFIG_INVALID",
      "CLI token must be at least 24 non-whitespace characters.",
      ExitCode.Configuration
    );
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return {
    apiUrl: url.toString().replace(/\/$/, ""),
    projectId,
    token: input.token
  };
}

export async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new CliError(
      "CONNECTION_FAILED",
      "DoneBond API returned an unsupported response type.",
      ExitCode.Network
    );
  }
  if (response.body === null) {
    throw new CliError(
      "CONNECTION_FAILED",
      "DoneBond API returned an empty validation response.",
      ExitCode.Network
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_CONNECTION_RESPONSE_BYTES) {
        await reader.cancel();
        throw new CliError(
          "CONNECTION_FAILED",
          "DoneBond API validation response is too large.",
          ExitCode.Network
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new CliError(
      "CONNECTION_FAILED",
      "DoneBond API returned malformed validation JSON.",
      ExitCode.Network,
      { cause: error }
    );
  }
}

export async function validateConnection(
  input: ConnectionInput,
  fetchImplementation: typeof fetch = fetch
): Promise<void> {
  const endpoint = `${input.apiUrl}/api/v1/projects/${encodeURIComponent(input.projectId)}`;
  let response: Response;
  try {
    response = await fetchImplementation(endpoint, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${input.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    throw new CliError(
      "CONNECTION_FAILED",
      "Could not validate the DoneBond API connection.",
      ExitCode.Network,
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new CliError(
      "CONNECTION_FAILED",
      `DoneBond API rejected the connection (HTTP ${response.status}).`,
      ExitCode.Network
    );
  }
  const body = await readBoundedJson(response);
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("publicId" in body) ||
    body.publicId !== input.projectId
  ) {
    throw new CliError(
      "CONNECTION_FAILED",
      "DoneBond API validation response does not match the requested project.",
      ExitCode.Network
    );
  }
}

function repositoryFingerprint(repositoryRoot: string): string {
  return createHash("sha256").update(repositoryRoot).digest("hex");
}

function connectionPaths(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv
): { configPath: string; credentialsPath: string; fingerprint: string } {
  const fingerprint = repositoryFingerprint(repositoryRoot);
  const directory = join(configRootDirectory(environment), "donebond", "repositories", fingerprint);
  return {
    configPath: join(directory, "config.json"),
    credentialsPath: join(directory, "credentials.json"),
    fingerprint
  };
}

function configRootDirectory(environment: NodeJS.ProcessEnv): string {
  const configured = environment.XDG_CONFIG_HOME;
  if (configured === undefined || configured.length === 0) {
    return join(homedir(), ".config");
  }
  if (!isAbsolute(configured)) {
    throw new CliError(
      "CONFIG_UNSAFE_PATH",
      "XDG_CONFIG_HOME must be an absolute path.",
      ExitCode.Configuration
    );
  }
  return configured;
}

async function assertNotSymbolicLink(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new CliError(
        "CONFIG_UNSAFE_PATH",
        "Refusing to store configuration through a symbolic link.",
        ExitCode.Configuration
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function assertSafeOwnedDirectory(path: string, allowSharedRead: boolean): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new CliError(
      "CONFIG_UNSAFE_PATH",
      "Refusing to store configuration through an unsafe directory.",
      ExitCode.Configuration
    );
  }
  if (process.platform !== "win32") {
    const currentUid = process.getuid?.();
    if (currentUid !== undefined && stats.uid !== currentUid) {
      throw new CliError(
        "CONFIG_UNSAFE_PATH",
        "Configuration directory must be owned by the current user.",
        ExitCode.Configuration
      );
    }
    if (allowSharedRead && (stats.mode & 0o022) !== 0) {
      throw new CliError(
        "CONFIG_UNSAFE_PATH",
        "Configuration root must not be writable by group or other users.",
        ExitCode.Configuration
      );
    }
  }
}

async function atomicPrivateWrite(path: string, content: string): Promise<void> {
  await assertNotSymbolicLink(path);
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function storeConnection(
  repositoryRoot: string,
  input: ConnectionInput,
  environment: NodeJS.ProcessEnv = process.env
): Promise<{ configPath: string; credentialsPath: string }> {
  const root = configRootDirectory(environment);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertSafeOwnedDirectory(root, true);

  const base = join(root, "donebond");
  await mkdir(base, { recursive: true, mode: 0o700 });
  await assertSafeOwnedDirectory(base, false);
  await chmod(base, 0o700);

  const fingerprint = repositoryFingerprint(repositoryRoot);
  const connectionDirectory = join(base, "repositories", fingerprint);
  await mkdir(connectionDirectory, { recursive: true, mode: 0o700 });
  await assertSafeOwnedDirectory(dirname(connectionDirectory), false);
  await assertSafeOwnedDirectory(connectionDirectory, false);
  await chmod(connectionDirectory, 0o700);

  const configPath = join(connectionDirectory, "config.json");
  const credentialsPath = join(connectionDirectory, "credentials.json");
  const config: StoredConnection = {
    schemaVersion: 1,
    apiUrl: input.apiUrl,
    projectId: input.projectId,
    repositoryFingerprint: fingerprint
  };
  const credential: StoredCredential = { schemaVersion: 1, token: input.token };
  await atomicPrivateWrite(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await atomicPrivateWrite(credentialsPath, `${JSON.stringify(credential, null, 2)}\n`);
  return { configPath, credentialsPath };
}

async function readPrivateJson(path: string): Promise<unknown> {
  const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new CliError(
        "CONFIG_INVALID",
        "DoneBond API configuration is missing; run donebond init.",
        ExitCode.Configuration
      );
    }
    throw error;
  });
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new CliError(
      "CONFIG_UNSAFE_PATH",
      "Refusing to read configuration through an unsafe filesystem entry.",
      ExitCode.Configuration
    );
  }
  if (stats.size > 16 * 1024 || (process.platform !== "win32" && (stats.mode & 0o077) !== 0)) {
    throw new CliError(
      "CONFIG_UNSAFE_PATH",
      "Configuration must be a small file readable only by the current user.",
      ExitCode.Configuration
    );
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new CliError(
      "CONFIG_INVALID",
      "DoneBond API configuration is malformed.",
      ExitCode.Configuration,
      { cause: error }
    );
  }
}

export async function loadConnection(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<ConnectionInput> {
  const paths = connectionPaths(repositoryRoot, environment);
  const root = configRootDirectory(environment);
  const base = join(root, "donebond");
  const repositories = join(base, "repositories");
  const connectionDirectory = dirname(paths.configPath);
  try {
    await assertSafeOwnedDirectory(root, true);
    await assertSafeOwnedDirectory(base, false);
    await assertSafeOwnedDirectory(repositories, false);
    await assertSafeOwnedDirectory(connectionDirectory, false);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(
        "CONFIG_INVALID",
        "DoneBond API configuration is missing; run donebond init.",
        ExitCode.Configuration
      );
    }
    throw error;
  }
  const [rawConfig, rawCredential] = await Promise.all([
    readPrivateJson(paths.configPath),
    readPrivateJson(paths.credentialsPath)
  ]);
  const config = rawConfig as Record<string, unknown>;
  const credential = rawCredential as Record<string, unknown>;
  if (
    typeof rawConfig !== "object" ||
    rawConfig === null ||
    Array.isArray(rawConfig) ||
    Object.keys(config).sort().join(",") !==
      "apiUrl,projectId,repositoryFingerprint,schemaVersion" ||
    config.schemaVersion !== 1 ||
    config.repositoryFingerprint !== paths.fingerprint ||
    typeof config.apiUrl !== "string" ||
    typeof config.projectId !== "string" ||
    typeof rawCredential !== "object" ||
    rawCredential === null ||
    Array.isArray(rawCredential) ||
    Object.keys(credential).sort().join(",") !== "schemaVersion,token" ||
    credential.schemaVersion !== 1 ||
    typeof credential.token !== "string"
  ) {
    throw new CliError(
      "CONFIG_INVALID",
      "DoneBond API configuration has an unsupported shape.",
      ExitCode.Configuration
    );
  }
  return normalizeConnection({
    apiUrl: config.apiUrl,
    projectId: config.projectId,
    token: credential.token
  });
}

export async function authenticatedGetJson(
  connection: ConnectionInput,
  path: string,
  fetchImplementation: typeof fetch = fetch
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(`${connection.apiUrl}${path}`, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${connection.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    throw new CliError("CONNECTION_FAILED", "Could not reach the DoneBond API.", ExitCode.Network, {
      cause: error
    });
  }
  if (!response.ok) {
    throw new CliError(
      "CONNECTION_FAILED",
      `DoneBond API rejected the request (HTTP ${response.status}).`,
      ExitCode.Network
    );
  }
  return readBoundedJson(response);
}

export async function authenticatedPostJson(
  connection: ConnectionInput,
  path: string,
  body: unknown,
  idempotencyKey: string,
  fetchImplementation: typeof fetch = fetch
): Promise<unknown> {
  const endpoint = `${connection.apiUrl}${path}`;
  const origin = new URL(connection.apiUrl).origin;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${connection.token}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          origin
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      });
      if (response.ok) return readBoundedJson(response);
      lastStatus = response.status;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      if (attempt === 2) {
        throw new CliError(
          "CONNECTION_FAILED",
          "Could not reach the DoneBond API after three attempts.",
          ExitCode.Network,
          { cause: error }
        );
      }
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw new CliError(
    "CONNECTION_FAILED",
    `DoneBond API rejected the evidence upload${lastStatus === undefined ? "" : ` (HTTP ${lastStatus})`}.`,
    lastStatus === 409 ? ExitCode.Conflict : ExitCode.Network
  );
}
