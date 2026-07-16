import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@donebond/db", "@donebond/evidence", "@donebond/shared", "@donebond/ui"],
  turbopack: {
    root: workspaceRoot
  }
};

export default nextConfig;
