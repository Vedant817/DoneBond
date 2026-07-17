import { readFile } from "node:fs/promises";

interface PackageManifest {
  version?: unknown;
}

export async function readVersion(): Promise<string> {
  const manifestUrl = new URL("../package.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as PackageManifest;
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("CLI package version is missing");
  }
  return manifest.version;
}
