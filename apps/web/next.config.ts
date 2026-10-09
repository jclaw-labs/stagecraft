import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { execFileSync } from "node:child_process";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@stagecraft/db", "@stagecraft/queue", "@stagecraft/shared"],
  // Monorepo root, so Next.js's file tracer can reach the workspace
  // packages outside this app's directory. The musician-site template is
  // no longer read from disk at runtime: it's bundled into src/generated/
  // before every build (see below and src/lib/template-bundle.ts).
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default function config(phase: string): NextConfig {
  // Regenerate the bundled template on every `next build` / `next dev`,
  // however it's invoked (npm script, turbo, or a host's own build
  // command), so a build can never ship a stale or missing template.
  // Next loads this config in several worker processes per build; the env
  // flag (inherited by those workers) keeps it to one run.
  const isBuildOrDev = phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER;
  if (isBuildOrDev && !process.env.STAGECRAFT_TEMPLATE_BUNDLED) {
    execFileSync("npm", ["run", "--silent", "generate"], {
      cwd: import.meta.dirname,
      stdio: "inherit",
    });
    process.env.STAGECRAFT_TEMPLATE_BUNDLED = "1";
  }
  return nextConfig;
}
