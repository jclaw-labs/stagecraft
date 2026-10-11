#!/usr/bin/env node
// @ts-check
/**
 * install-musician-site-shell.mjs — build `@jclaw-labs/content-upgraders`
 * and `@jclaw-labs/musician-site`, then install them into the artist-repo
 * shell at `templates/musician-site-shell` (ADR-016 §1).
 *
 * The shell depends on the package through `file:../musician-site`, and
 * its `.npmrc` sets `install-links`, so npm installs a packed copy of
 * `dist/` with the package's dependencies alongside, the way a site
 * installs the package from npm. That copy is a snapshot: re-run this
 * after changing the package before running the shell (`npm run dev`,
 * `next build`, the e2e suite or screenshot capture).
 *
 * Usage (from the repo root, after `npm ci` at the root and in
 * templates/musician-site):
 *   npm run shell:install
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TEMPLATE_DIR, UPGRADERS_DIR } from "./pack-musician-site.mjs";

export const SHELL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates/musician-site-shell");

/** @param {string[]} args @param {string} cwd */
function npm(args, cwd) {
  execFileSync("npm", args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
}

/**
 * @param {{ run?: (args: string[], cwd: string) => void; remove?: (dir: string) => void }} [deps]
 *   `npm` and the directory removal, replaceable in tests.
 */
export function installMusicianSiteShell({
  run = npm,
  remove = (dir) => fs.rmSync(dir, { recursive: true, force: true }),
} = {}) {
  run(["run", "build"], UPGRADERS_DIR);
  run(["run", "build:package"], TEMPLATE_DIR);
  // npm keeps an installed copy whose version hasn't changed, so drop the
  // copies first to install the packages as just built.
  remove(path.join(SHELL_DIR, "node_modules/@jclaw-labs"));
  run(["install", "--no-audit", "--no-fund"], SHELL_DIR);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) installMusicianSiteShell();
