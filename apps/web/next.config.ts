import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@stagecraft/db", "@stagecraft/queue", "@stagecraft/shared"],
  // Monorepo root, so Next.js's file tracer resolves the hoisted workspace
  // packages. The musician-site template no longer needs tracing: it is
  // bundled at build time into src/generated/template-bundle.json (see
  // scripts/generate-template-bundle.mjs) and imported by the jobs.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
