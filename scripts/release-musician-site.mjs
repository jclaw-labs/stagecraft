#!/usr/bin/env node
// @ts-check
/**
 * release-musician-site.mjs — the decisions the release workflow
 * (`.github/workflows/release-musician-site.yml`) makes, kept here so they
 * have tests (ADR-016 §2).
 *
 *   plan
 *     Reads the two lockstep versions and asks npm what's already there.
 *     Prints, and appends to $GITHUB_OUTPUT when set:
 *       version             the version in both package.json files
 *       dist_tag            `rc` for a prerelease, `latest` otherwise
 *       git_tag             `musician-site@<version>`
 *       publish             `true` when the template version isn't on npm
 *       upgraders_published `true` when the upgraders version is on npm
 *       tagged              `true` when the git tag is already on origin
 *
 *   verify-upgraders <tarball>
 *     For a rerun where `@jclaw-labs/content-upgraders` is already on npm at
 *     this version: fails unless the published package holds the same files
 *     as the local tarball. It compares the unpacked files, not the tarballs,
 *     since two packs of the same files differ in timestamps.
 *
 * Usage (from the repo root): node scripts/release-musician-site.mjs <command> [...]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NPM_REGISTRY } from "../apps/web/scripts/generate-template-bundle.mjs";
import { assertLockstep, TEMPLATE_DIR, UPGRADERS_DIR, UPGRADERS_NAME } from "./pack-musician-site.mjs";

export { NPM_REGISTRY };

/** The dist-tag a release candidate (any prerelease) goes to, so `latest` doesn't move. */
export const PRERELEASE_DIST_TAG = "rc";

/** A semver version, release or prerelease, with no build metadata. */
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * The npm dist-tag `version` publishes to.
 *
 * @param {string} version
 * @returns {"latest" | typeof PRERELEASE_DIST_TAG}
 */
export function distTagFor(version) {
  const match = VERSION.exec(version);
  if (!match) throw new Error(`Not a version this workflow publishes: ${JSON.stringify(version)}`);
  return match[1] ? PRERELEASE_DIST_TAG : "latest";
}

/** @param {string} version */
export function gitTagFor(version) {
  return `musician-site@${version}`;
}

/**
 * Whether `name@version` is on the registry.
 *
 * @param {string} name
 * @param {string} version
 * @param {{ fetchImpl?: typeof fetch; registry?: string }} [options]
 */
export async function isPublished(name, version, { fetchImpl = fetch, registry = NPM_REGISTRY } = {}) {
  const url = `${registry}/${name.replace("/", "%2f")}/${encodeURIComponent(version)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`Checking ${name}@${version} on ${url} failed with HTTP ${res.status}`);
}

/**
 * Every file under `dir`, as posix paths relative to it, sorted.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/**
 * How the files under `publishedDir` differ from those under `localDir`:
 * one line per file missing from either side or with different bytes.
 * Empty when they hold the same files.
 *
 * @param {string} publishedDir
 * @param {string} localDir
 * @returns {string[]}
 */
export function diffFileTrees(publishedDir, localDir) {
  const published = new Set(listFiles(publishedDir));
  const local = new Set(listFiles(localDir));
  /** @type {string[]} */
  const differences = [];
  for (const file of [...new Set([...published, ...local])].sort()) {
    if (!local.has(file)) differences.push(`only in the published package: ${file}`);
    else if (!published.has(file)) differences.push(`only in the local pack: ${file}`);
    else if (!fs.readFileSync(path.join(publishedDir, file)).equals(fs.readFileSync(path.join(localDir, file)))) {
      differences.push(`differs: ${file}`);
    }
  }
  return differences;
}

/** @param {string} tarball @param {string} dest */
function unpack(tarball, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", dest], { stdio: ["ignore", "inherit", "inherit"] });
}

/**
 * Fail unless `name@version` on npm holds the same files as `localTarball`.
 *
 * @param {{ name: string; version: string; localTarball: string }} options
 */
export function verifyPublishedMatches({ name, version, localTarball }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "verify-published-"));
  try {
    const out = execFileSync("npm", ["pack", `${name}@${version}`, "--json", "--pack-destination", work], {
      cwd: work,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    const [{ filename }] = JSON.parse(out);
    unpack(path.join(work, filename), path.join(work, "published"));
    unpack(localTarball, path.join(work, "local"));
    const differences = diffFileTrees(path.join(work, "published"), path.join(work, "local"));
    if (differences.length > 0) {
      throw new Error(
        [
          `${name}@${version} is already on npm with different contents from this commit's pack.`,
          "Released versions never change: bump both package versions and release again.",
          ...differences.map((d) => `  - ${d}`),
        ].join("\n"),
      );
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** @param {string} dir */
function readPackageJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
}

/** @param {string} tag */
function tagOnOrigin(tag) {
  return execFileSync("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { encoding: "utf8" }).trim() !== "";
}

/**
 * @param {{
 *   template: { name: string; version: string; [key: string]: unknown };
 *   upgraders: { name: string; version: string; [key: string]: unknown };
 *   published: (name: string, version: string) => Promise<boolean>;
 *   tagged: (tag: string) => boolean;
 * }} input
 */
export async function planRelease({ template, upgraders, published, tagged }) {
  assertLockstep(template, upgraders);
  if (upgraders.name !== UPGRADERS_NAME) throw new Error(`Expected ${UPGRADERS_NAME}, found ${upgraders.name}`);
  const { version } = template;
  const gitTag = gitTagFor(version);
  return {
    version,
    dist_tag: distTagFor(version),
    git_tag: gitTag,
    publish: !(await published(template.name, version)),
    upgraders_published: await published(upgraders.name, version),
    tagged: tagged(gitTag),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "plan") {
    const plan = await planRelease({
      template: readPackageJson(TEMPLATE_DIR),
      upgraders: readPackageJson(UPGRADERS_DIR),
      published: (name, version) => isPublished(name, version),
      tagged: tagOnOrigin,
    });
    console.log(JSON.stringify(plan, null, 2));
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(plan)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(""),
      );
    }
  } else if (command === "verify-upgraders" && args[0]) {
    const { name, version } = readPackageJson(UPGRADERS_DIR);
    verifyPublishedMatches({ name, version, localTarball: path.resolve(args[0]) });
    console.log(`${name}@${version} on npm matches the local pack.`);
  } else {
    console.error("Usage: node scripts/release-musician-site.mjs plan | verify-upgraders <tarball>");
    process.exit(2);
  }
}
