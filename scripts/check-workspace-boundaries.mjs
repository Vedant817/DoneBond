import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspacePaths = [
  "apps/web",
  "apps/cli",
  "packages/contracts",
  "packages/db",
  "packages/evidence",
  "packages/shared",
  "packages/ui",
  "packages/config",
  "tests/e2e"
];

const allowedInternalDependencies = new Map([
  [
    "@donebond/web",
    new Set(["@donebond/db", "@donebond/evidence", "@donebond/shared", "@donebond/ui"])
  ],
  ["@donebond/cli", new Set(["@donebond/evidence", "@donebond/shared"])],
  ["@donebond/contracts", new Set()],
  ["@donebond/db", new Set(["@donebond/shared"])],
  ["@donebond/evidence", new Set(["@donebond/shared"])],
  ["@donebond/shared", new Set()],
  ["@donebond/ui", new Set(["@donebond/shared"])],
  ["@donebond/config", new Set()],
  ["@donebond/e2e", new Set(["@donebond/web"])]
]);

async function readPackage(root, workspacePath) {
  const packagePath = path.join(root, workspacePath, "package.json");
  const source = await readFile(packagePath, "utf8");
  return { packagePath, manifest: JSON.parse(source) };
}

export async function validateWorkspaceGraph(root) {
  const packages = await Promise.all(
    workspacePaths.map((workspacePath) => readPackage(root, workspacePath))
  );
  const names = new Set(packages.map(({ manifest }) => manifest.name));
  const errors = [];

  if (names.size !== packages.length) {
    errors.push("Workspace package names must be unique.");
  }

  for (const { packagePath, manifest } of packages) {
    const allowed = allowedInternalDependencies.get(manifest.name);
    if (!allowed) {
      errors.push(`${packagePath}: unknown workspace package name ${String(manifest.name)}`);
      continue;
    }

    const dependencyGroups = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies
    ];
    const internalDependencies = dependencyGroups
      .filter((group) => group && typeof group === "object")
      .flatMap((group) => Object.keys(group))
      .filter((name) => name.startsWith("@donebond/"));

    for (const dependency of internalDependencies) {
      if (!names.has(dependency)) {
        errors.push(`${packagePath}: internal dependency ${dependency} does not exist`);
      } else if (!allowed.has(dependency)) {
        errors.push(`${packagePath}: ${manifest.name} may not depend on ${dependency}`);
      }
    }
  }

  return errors;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await validateWorkspaceGraph(root);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Workspace dependency boundaries OK\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
