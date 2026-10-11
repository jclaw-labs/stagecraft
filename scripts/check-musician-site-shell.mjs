#!/usr/bin/env node
// @ts-check
/**
 * check-musician-site-shell.mjs — the pre-publish check for
 * `@jclaw-labs/musician-site` (ADR-016 §2): build the artist-repo shell the
 * way Netlify and Vercel build a site, on the tarballs about to be
 * published.
 *
 * Packs both packages with `pack-musician-site.mjs` (local mode: the
 * template depends on the upgraders tarball), copies the shell into a clean
 * directory without its monorepo-only files (`node_modules`, `.next`,
 * `.npmrc`, any lockfile), points its `file:` dependency on the package at
 * the template tarball and drops its `overrides`, installs **without a
 * lockfile**, and runs `next build`.
 *
 * The release workflow (`.github/workflows/release-musician-site.yml`) runs
 * it before publishing anything, and `musician-site-package.yml` runs it
 * on pull requests that touch the packages or the shell.
 *
 * Usage (from the repo root, after `npm ci` at the root and in
 * templates/musician-site):
 *   node scripts/check-musician-site-shell.mjs [--keep]
 *
 * `--keep` leaves the work directory in place and prints its path.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SHELL_DIR } from "./install-musician-site-shell.mjs";
import { packMusicianSite, TEMPLATE_DIR } from "./pack-musician-site.mjs";

/** Shell entries a site repo never has: build output, installs, and monorepo-only config. */
export const SHELL_COPY_SKIP = new Set(["node_modules", ".next", ".npmrc", "package-lock.json", "CLAUDE.md"]);

/**
 * Whether `relativePath` (inside the shell, posix or native separators)
 * goes into the clean copy.
 *
 * @param {string} relativePath
 */
export function copiesIntoCleanShell(relativePath) {
  return !relativePath
    .split(/[\\/]/)
    .some((segment) => SHELL_COPY_SKIP.has(segment) || segment.endsWith(".tsbuildinfo"));
}

/**
 * The shell's package.json for the check: the package installed from
 * `templateTarball` in place of the `file:` link to its source, and no
 * `overrides` (they point at the monorepo copy of the upgraders, while
 * the template tarball names the upgraders tarball itself).
 *
 * @param {{ dependencies?: Record<string, string>; overrides?: unknown; [key: string]: unknown }} shellPackage
 * @param {{ packageName: string; templateTarball: string }} options
 */
export function cleanShellPackageJson(shellPackage, { packageName, templateTarball }) {
  const spec = shellPackage.dependencies?.[packageName];
  if (typeof spec !== "string" || !spec.startsWith("file:")) {
    throw new Error(`The shell must depend on ${packageName} through file:, not ${JSON.stringify(spec)}.`);
  }
  const { overrides: _overrides, ...rest } = shellPackage;
  return { ...rest, dependencies: { ...shellPackage.dependencies, [packageName]: `file:${templateTarball}` } };
}

/**
 * Copy the shell into `dest`, without the entries `SHELL_COPY_SKIP` names,
 * and with its package.json from `cleanShellPackageJson`.
 *
 * @param {{ shellDir?: string; dest: string; packageName: string; templateTarball: string }} options
 */
export function copyCleanShell({ shellDir = SHELL_DIR, dest, packageName, templateTarball }) {
  fs.cpSync(shellDir, dest, {
    recursive: true,
    filter: (src) => copiesIntoCleanShell(path.relative(shellDir, src)),
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(shellDir, "package.json"), "utf8"));
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify(cleanShellPackageJson(pkg, { packageName, templateTarball }), null, 2) + "\n",
  );
}

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

export function checkMusicianSiteShell({ keep = false } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "musician-site-shell-check-"));
  try {
    const { template } = packMusicianSite({ outDir: path.join(work, "pack") });
    const { name: packageName } = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf8"));
    const site = path.join(work, "site");
    copyCleanShell({ dest: site, packageName, templateTarball: template });

    console.log("Installing the tarballs into a clean copy of the shell, with no lockfile…");
    run("npm", ["install", "--no-package-lock", "--no-audit", "--no-fund"], site);
    if (fs.existsSync(path.join(site, "package-lock.json"))) throw new Error("npm wrote a lockfile");

    console.log("Running next build…");
    process.stdout.write(run("npx", ["--no-install", "next", "build"], site));
    console.log(keep ? `Done. Site kept at ${site}` : "Done.");
  } finally {
    if (!keep) fs.rmSync(work, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) checkMusicianSiteShell({ keep: process.argv.includes("--keep") });
