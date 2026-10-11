#!/usr/bin/env node
// @ts-check
/**
 * check-changelog.mjs — a pull request that changes the package source
 * under `templates/musician-site/src` must add a `CHANGELOG.md` entry
 * marked patch, minor or major (ADR-016 §2, §3).
 *
 * An entry is a line under `## Unreleased` in
 * `templates/musician-site/CHANGELOG.md` of the form
 *
 *   - patch: What changed, for someone running a site.
 *
 * with `minor` or `major` in place of `patch`. The check passes when the
 * branch's Unreleased section has at least one entry the base's doesn't.
 * Test files (`*.test.*`, `*.spec.*`, `__snapshots__/`) don't count as a
 * change: they aren't in the published package.
 *
 * Usage: node scripts/check-changelog.mjs --base origin/main
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_SOURCE_DIR = "templates/musician-site/src/";
export const CHANGELOG_PATH = "templates/musician-site/CHANGELOG.md";

/** @typedef {"patch" | "minor" | "major"} ReleaseLevel */

/** An entry line, capturing its level. */
const ENTRY = /^- (patch|minor|major): \S/;

/** Files under the package source that aren't shipped in it. */
const NOT_SHIPPED = /(?:^|\/)__snapshots__\/|\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;

/**
 * Whether any of `files` (repo-relative paths) changes the package source.
 *
 * @param {string[]} files
 */
export function changesPackageSource(files) {
  return files.some((file) => file.startsWith(PACKAGE_SOURCE_DIR) && !NOT_SHIPPED.test(file));
}

/**
 * The entry lines under `## Unreleased` in `changelog`, trimmed.
 *
 * @param {string} changelog
 * @returns {string[]}
 */
export function unreleasedEntries(changelog) {
  /** @type {string[]} */
  const entries = [];
  let inUnreleased = false;
  for (const raw of changelog.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^## /.test(line)) {
      inUnreleased = /^## Unreleased\s*$/i.test(line);
    } else if (inUnreleased && ENTRY.test(line)) {
      entries.push(line);
    }
  }
  return entries;
}

/**
 * The Unreleased entries in `head` that `base` doesn't have (counting
 * duplicates), with their levels.
 *
 * @param {string} base
 * @param {string} head
 * @returns {Array<{ level: ReleaseLevel; line: string }>}
 */
export function addedEntries(base, head) {
  const remaining = unreleasedEntries(base);
  /** @type {Array<{ level: ReleaseLevel; line: string }>} */
  const added = [];
  for (const line of unreleasedEntries(head)) {
    const i = remaining.indexOf(line);
    if (i >= 0) {
      remaining.splice(i, 1);
      continue;
    }
    const match = ENTRY.exec(line);
    if (match) added.push({ level: /** @type {ReleaseLevel} */ (match[1]), line });
  }
  return added;
}

/**
 * The check's verdict.
 *
 * @param {{ files: string[]; baseChangelog: string; headChangelog: string }} input
 * @returns {{ ok: boolean; message: string }}
 */
export function checkChangelog({ files, baseChangelog, headChangelog }) {
  if (!changesPackageSource(files)) {
    return { ok: true, message: `No change under ${PACKAGE_SOURCE_DIR}; no changelog entry needed.` };
  }
  const added = addedEntries(baseChangelog, headChangelog);
  if (added.length > 0) {
    return { ok: true, message: `Changelog entries added: ${added.map((e) => e.level).join(", ")}.` };
  }
  return {
    ok: false,
    message: [
      `This PR changes ${PACKAGE_SOURCE_DIR} but adds no entry under "## Unreleased" in ${CHANGELOG_PATH}.`,
      'Add a line like "- patch: What changed." (or minor / major; see the semver rules in',
      "templates/musician-site/README.md).",
    ].join("\n"),
  };
}

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
}

/** @param {string} ref @param {string} file */
function showOrEmpty(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const baseIndex = process.argv.indexOf("--base");
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : "origin/main";
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  const files = git(["diff", "--name-only", `${mergeBase}...HEAD`]).split("\n").filter(Boolean);
  const { ok, message } = checkChangelog({
    files,
    baseChangelog: showOrEmpty(mergeBase, CHANGELOG_PATH),
    headChangelog: showOrEmpty("HEAD", CHANGELOG_PATH),
  });
  console.log(message);
  if (!ok) process.exit(1);
}
