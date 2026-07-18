#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const MAX_FILE_BYTES = 1024 * 1024;
const PLACEHOLDER_PARTS = [
  "changeme",
  "example",
  "placeholder",
  "replace_me",
  "replace-me",
  "your_",
  "your-",
  "dummy",
  "test-only"
];
const KNOWN_SAFE_FIXTURES = new Set([["AKIA", "ABCDEFGHIJKLMNOP"].join("")]);

const rules = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    name: "GitHub token",
    pattern: /\b(?:gh[opusr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{80,255})\b/g
  },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,255}\b/g },
  {
    name: "assigned credential",
    pattern:
      /\b(?:api[_-]?key|client[_-]?secret|private[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi,
    valueGroup: 1
  }
];

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    KNOWN_SAFE_FIXTURES.has(value.trim()) ||
    normalized.startsWith("${") ||
    normalized.startsWith("process.env.") ||
    normalized.startsWith("env.") ||
    PLACEHOLDER_PARTS.some((part) => normalized.includes(part))
  );
}

export function scanText(text, source) {
  const findings = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const value = rule.valueGroup === undefined ? match[0] : match[rule.valueGroup];
      if (isPlaceholder(value)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({ rule: rule.name, source, line });
    }
  }
  return findings;
}

function parseArguments(argv) {
  const options = { history: false, paths: [], root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--history") options.history = true;
    else if (argument === "--root") options.root = resolve(argv[++index] ?? "");
    else if (argument === "--path") options.paths.push(argv[++index] ?? "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.paths.some((path) => path.length === 0)) throw new Error("--path requires a value");
  return options;
}

function git(root, args, encoding = "utf8") {
  return execFileSync("git", ["-C", root, ...args], {
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function trackedPaths(root) {
  return git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
}

function scanFile(root, path) {
  const absolutePath = resolve(root, path);
  if (statSync(absolutePath).size > MAX_FILE_BYTES) return [];
  const contents = readFileSync(absolutePath);
  if (contents.includes(0)) return [];
  return scanText(contents.toString("utf8"), path);
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const paths = options.paths.length > 0 ? options.paths : trackedPaths(options.root);
  const findings = paths.flatMap((path) => scanFile(options.root, path));

  if (options.history) {
    const history = git(options.root, [
      "log",
      "--all",
      "--format=",
      "--no-ext-diff",
      "--no-textconv",
      "-p"
    ]);
    findings.push(...scanText(history, "<git-history>"));
  }

  if (findings.length > 0) {
    console.error(`Secret scan failed with ${findings.length} potential credential(s):`);
    for (const finding of findings) {
      console.error(`- ${finding.source}:${finding.line} (${finding.rule})`);
    }
    return 1;
  }

  console.log(
    `Secret scan passed (${paths.length} tracked file(s) checked${options.history ? ", including Git history" : ""}).`
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(
      `Secret scan could not complete: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 2;
  }
}
