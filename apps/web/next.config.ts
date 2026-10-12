import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (exports → ./src/index.ts).
  transpilePackages: ["@arbolito/config", "@arbolito/chain", "@arbolito/router", "@arbolito/proof", "@arbolito/db", "@arbolito/llm"],
  serverExternalPackages: ["pg"],
  outputFileTracingRoot: repoRoot,
  // The JSON fallback for receipts (docs/receipts) lives outside apps/web; ship it with the server functions.
  outputFileTracingIncludes: { "/**": ["../../docs/receipts/*.json"] },
  turbopack: { root: repoRoot },
  poweredByHeader: false,
};

export default nextConfig;
