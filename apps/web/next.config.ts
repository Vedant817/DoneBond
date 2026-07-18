import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; base-uri 'self'; connect-src 'self' https:; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests"
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" }
] as const;

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders] }];
  },
  transpilePackages: ["@donebond/db", "@donebond/evidence", "@donebond/shared", "@donebond/ui"],
  turbopack: {
    root: workspaceRoot
  }
};

export default nextConfig;
