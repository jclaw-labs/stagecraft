import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@stagecraft/db", "@stagecraft/queue", "@stagecraft/shared"],
  // Monorepo root, so Next.js's file tracer can reach the workspace
  // packages outside this app's directory. The musician-site template is
  // no longer read from disk at runtime: it's bundled at build time into
  // src/generated/ (npm run generate, see src/lib/template-bundle.ts).
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
