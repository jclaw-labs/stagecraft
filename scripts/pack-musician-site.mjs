#!/usr/bin/env node
// @ts-check
/**
 * pack-musician-site.mjs — build and pack `@jclaw-labs/content-upgraders`
 * and `@jclaw-labs/musician-site` into npm tarballs (ADR-016 §2).
 *
 * In the monorepo the template depends on the upgraders through
 * `file:../../packages/content-upgraders`, which can't install anywhere
 * else. The packed template points that dependency at:
 *
 *   - the upgraders tarball, by absolute path (default, for local checks);
 *   - the exact upgraders version on npm (`--release`, for publishing).
 *
 * The packed template also drops the `source` condition from its
 * `imports` targets, since `src/` isn't in the tarball. Both packages are
 * versioned in lockstep, and the script refuses to pack when they differ.
 *
 * Usage (from the repo root, after `npm ci` at the root and in
 * templates/musician-site):
 *   node scripts/pack-musician-site.mjs [--release] [--out DIR]
 *
 * Prints the two tarball paths as JSON on the last line of stdout.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const UPGRADERS_DIR = path.join(REPO_ROOT, "packages/content-upgraders");
export const TEMPLATE_DIR = path.join(REPO_ROOT, "templates/musician-site");
export const UPGRADERS_NAME = "@jclaw-labs/content-upgraders";

/**
 * @typedef {{
 *   name: string;
 *   version: string;
 *   imports?: Record<string, string | Record<string, string>>;
 *   dependencies?: Record<string, string>;
 *   [key: string]: unknown;
 * }} PackageJson
 */

/**
 * The template's package.json as it goes into the tarball: the upgraders
 * dependency set to `upgradersSpec`, and no `source` conditions.
 *
 * @param {PackageJson} pkg
 * @param {string} upgradersSpec
 * @returns {PackageJson}
 */
export function packedTemplatePackageJson(pkg, upgradersSpec) {
  if (!pkg.dependencies?.[UPGRADERS_NAME]) {
    throw new Error(`${pkg.name} has no ${UPGRADERS_NAME} dependency to pin.`);
  }
  /** @type {PackageJson["imports"]} */
  const imports = {};
  for (const [key, target] of Object.entries(pkg.imports ?? {})) {
    if (typeof target === "string") {
      imports[key] = target;
    } else {
      const { source: _source, ...rest } = target;
      imports[key] = rest;
    }
  }
  return {
    ...pkg,
    ...(pkg.imports ? { imports } : {}),
    dependencies: { ...pkg.dependencies, [UPGRADERS_NAME]: upgradersSpec },
  };
}

/**
 * The upgraders spec the packed template depends on.
 *
 * @param {{ release: boolean; upgradersVersion: string; upgradersTarball: string }} input
 */
export function upgradersSpec({ release, upgradersVersion, upgradersTarball }) {
  return release ? upgradersVersion : `file:${upgradersTarball}`;
}

/**
 * Both packages must carry the same version.
 *
 * @param {PackageJson} template
 * @param {PackageJson} upgraders
 */
export function assertLockstep(template, upgraders) {
  if (template.version !== upgraders.version) {
    throw new Error(
      `${template.name}@${template.version} and ${upgraders.name}@${upgraders.version} must share a version.`,
    );
  }
}

/** @param {string} dir @returns {PackageJson} */
function readPackageJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
}

/**
 * `npm pack` in `dir` into `outDir`; returns the tarball's absolute path.
 *
 * @param {string} dir
 * @param {string} outDir
 */
function npmPack(dir, outDir) {
  const out = execFileSync("npm", ["pack", "--json", "--pack-destination", outDir], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [{ filename }] = JSON.parse(out);
  return path.join(outDir, filename);
}

/**
 * The files `npm pack` would include from `dir`, relative to it.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function packFileList(dir) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [{ files }] = JSON.parse(out);
  return files.map((/** @type {{ path: string }} */ f) => f.path);
}

/**
 * Build and pack both packages into `outDir`.
 *
 * @param {{ release?: boolean; outDir: string }} options
 * @returns {{ upgraders: string; template: string }}
 */
export function packMusicianSite({ release = false, outDir }) {
  const upgraders = readPackageJson(UPGRADERS_DIR);
  const template = readPackageJson(TEMPLATE_DIR);
  assertLockstep(template, upgraders);
  fs.mkdirSync(outDir, { recursive: true });

  execFileSync("npm", ["run", "build"], { cwd: UPGRADERS_DIR, stdio: ["ignore", "inherit", "inherit"] });
  const upgradersTarball = npmPack(UPGRADERS_DIR, outDir);

  execFileSync("npm", ["run", "build:package"], { cwd: TEMPLATE_DIR, stdio: ["ignore", "inherit", "inherit"] });
  // Pack a staged copy, so the rewritten package.json never touches the
  // checkout.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "musician-site-pack-"));
  try {
    for (const file of packFileList(TEMPLATE_DIR)) {
      fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
      fs.copyFileSync(path.join(TEMPLATE_DIR, file), path.join(stage, file));
    }
    const spec = upgradersSpec({ release, upgradersVersion: upgraders.version, upgradersTarball });
    fs.writeFileSync(
      path.join(stage, "package.json"),
      JSON.stringify(packedTemplatePackageJson(template, spec), null, 2) + "\n",
    );
    return { upgraders: upgradersTarball, template: npmPack(stage, outDir) };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(REPO_ROOT, ".pack"));
  const result = packMusicianSite({ release: args.includes("--release"), outDir });
  console.log(JSON.stringify(result));
}
