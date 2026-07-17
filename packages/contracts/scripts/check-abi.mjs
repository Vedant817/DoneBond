import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const committed = JSON.parse(
  readFileSync(new URL("../abi/DoneBondRegistry.json", import.meta.url), "utf8")
);
const generated = JSON.parse(
  execFileSync(
    "forge",
    ["inspect", "src/DoneBondRegistry.sol:DoneBondRegistry", "abi", "--json"],
    { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  )
);

assert.deepEqual(
  committed,
  generated,
  "Committed ABI is stale; regenerate packages/contracts/abi/DoneBondRegistry.json"
);
process.stdout.write("Committed DoneBondRegistry ABI matches Solidity source\n");
