import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { execFileSync } from "node:child_process";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@stagecraft/db", "@stagecraft/queue", "@stagecraft/shared"],
  // Monorepo root, so Next.js's file tracer resolves the hoisted workspace
  // packages. The musician-site template no longer needs tracing: it is
  // bundled at build time into src/generated/template-bundle.json (see
  // scripts/generate-template-bundle.mjs) and imported by the jobs.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default function config(phase: string): NextConfig {
  // Next loads this config in several processes per build; the env flag, inherited by the later ones, keeps generation to one run.
  const isBuildOrDev = phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER;
  if (isBuildOrDev && !process.env.STAGECRAFT_TEMPLATE_BUNDLED) {
    execFileSync(process.execPath, ["scripts/generate-template-bundle.mjs"], {
      cwd: import.meta.dirname,
      stdio: "inherit",
    });
    process.env.STAGECRAFT_TEMPLATE_BUNDLED = "1";
  }
  return nextConfig;
}
