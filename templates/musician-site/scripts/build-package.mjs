/**
 * Build the published package: `tsc` compiles `src/` into `dist/` (one
 * ESM file plus `.d.ts` per source file, per ADR-016 §1), then the
 * global stylesheet is copied alongside, since `tsc` only emits code.
 *
 * Usage: npm run build:package
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Compile into `outDir` (default `dist/`), replacing what was there. */
export function buildPackage(outDir = path.join(PACKAGE_ROOT, "dist")) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const tsc = path.join(PACKAGE_ROOT, "node_modules/typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json", "--outDir", outDir], {
    cwd: PACKAGE_ROOT,
    stdio: "inherit",
  });
  fs.copyFileSync(path.join(PACKAGE_ROOT, "src/app/globals.css"), path.join(outDir, "app/globals.css"));
  fs.chmodSync(path.join(outDir, "cli/stagecraft-site.js"), 0o755);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) buildPackage();
