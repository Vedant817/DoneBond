#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

import { runCli } from "./main.js";

export { ExitCode } from "./errors.js";
export { initializeRepository } from "./init.js";
export { runCli } from "./main.js";

const entrypoint = process.argv[1];
const isEntrypoint =
  entrypoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entrypoint)).href;

if (isEntrypoint) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
