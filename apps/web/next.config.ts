import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@stagecraft/db", "@stagecraft/queue", "@stagecraft/shared"],
  // Monorepo root — required so Next.js's file tracer can reach files
  // outside this app's directory (specifically templates/, which is a
  // peer of apps/web/, not under it).
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Include the new musician-site template in the Lambda bundle so
  // create_site jobs can read it via fs at runtime. The worker is
  // initialized in instrumentation.ts and runs in whichever API Lambda
  // happens to be alive, so include broadly across /api/**.
  outputFileTracingIncludes: {
    "/api/**/*": ["../../templates/musician-site/**/*"],
  },
};

export default nextConfig;
