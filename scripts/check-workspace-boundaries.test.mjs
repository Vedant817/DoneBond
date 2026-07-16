import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateWorkspaceGraph } from "./check-workspace-boundaries.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("accepts the documented DoneBond dependency graph", async () => {
  assert.deepEqual(await validateWorkspaceGraph(repositoryRoot), []);
});

test("rejects a shared-to-application dependency", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "donebond-boundaries-"));
  await Promise.all(
    ["apps", "packages", "tests"].map((directory) =>
      cp(path.join(repositoryRoot, directory), path.join(temporaryRoot, directory), {
        recursive: true
      })
    )
  );

  const sharedManifestPath = path.join(temporaryRoot, "packages/shared/package.json");
  const sharedManifest = JSON.parse(await readFile(sharedManifestPath, "utf8"));
  sharedManifest.dependencies = { "@donebond/web": "workspace:*" };
  await writeFile(sharedManifestPath, `${JSON.stringify(sharedManifest, null, 2)}\n`);

  const errors = await validateWorkspaceGraph(temporaryRoot);
  assert.ok(errors.some((error) => error.includes("may not depend on @donebond/web")));
});
