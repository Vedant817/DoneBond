import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { PublicIdentifierSchema } from "../../../packages/shared/dist/identifiers.js";

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

async function readBoundedJson(response: Response): Promise<unknown> {
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
