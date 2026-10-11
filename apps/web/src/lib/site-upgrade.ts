/**
 * What the `upgrade_site` job (`jobs/upgrade-site.ts`) decides about a
 * site's repo, kept apart from the GitHub calls so each rule is tested on
 * plain data (ADR-016 §4):
 *
 *   - which of the site's files are ours, and whether the artist changed any
 *     of them since the baseline (the stamp's manifest, or the template push
 *     for a site from before the manifest);
 *   - which files the upgrade writes and deletes;
 *   - which content files the target release's upgrader chain rewrites;
 *   - the pull request's title and body.
 */
import {
  LATEST_SCHEMA_VERSION,
  OLDEST_SCHEMA_VERSION,
  upgradeCollection,
  type CollectionJson,
} from "@jclaw-labs/content-upgraders";
import semver from "semver";

import {
  ARTIST_PATH_PREFIXES,
  codePathManifest,
  gitBlobSha,
  MUSICIAN_SITE_PACKAGE,
  packageVersionFromFiles,
  SITE_AUTOMERGE_WORKFLOW_PATH,
  TEMPLATE_STAMP_PATH,
  type CodePathManifest,
} from "@/lib/site-scaffold";
import type { TemplateFile } from "@/lib/template-reader";

/** The branch every upgrade pull request comes from. Re-runs reuse it. */
export const UPGRADE_BRANCH = "stagecraft/upgrade";

/**
 * For a site without a manifest, the template push is the oldest commit
 * touching this directory (ADR-016 §4). The repo's first commit is GitHub's
 * `auto_init` README, so it can't be the baseline.
 */
export const TEMPLATE_PUSH_MARKER_PATH = "src/lib";

/**
 * Our code in a site, by directory, before it moves onto the package
 * (ADR-016 §4). A file added under one of these counts as a change too.
 * `src/admin/` and `src/api/` hold the routed modules the template has
 * shipped since #479, before stamps carried a manifest (#482).
 */
export const CODE_PATH_PREFIXES = [
  "src/lib/",
  "src/components/",
  "src/puck/",
  "src/app/",
  "src/admin/",
  "src/api/",
] as const;

/** Our code in a site, as single files at fixed paths. */
export const CODE_PATH_FILES = ["src/middleware.ts", "next.config.ts"] as const;

/** Lockfiles: never a customization, and the upgrade deletes them (sites ship none). */
export const LOCKFILE_NAMES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"] as const;

/** Where the site's package.json lives. Merged Dependabot PRs edit its versions. */
const PACKAGE_JSON = "package.json";

/** A file the README GitHub's `auto_init` commits: the artist's, not ours. */
const AUTO_INIT_README = "README.md";

/** The dependency maps whose version values Dependabot bumps. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/** `src/content/**\/_collection.json`: a collection definition, versioned by `schemaVersion`. */
const COLLECTION_FILE = /^src\/content\/(?:.+\/)?_collection\.json$/;

export function isCodePath(path: string): boolean {
  return (
    CODE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    (CODE_PATH_FILES as readonly string[]).includes(path)
  );
}

/**
 * The artist's paths (`ARTIST_PATH_PREFIXES`, the same ones the stamp's
 * manifest leaves out): the content the CMS writes and their images. The
 * upgrade never writes or deletes here, apart from content the target
 * release's upgrader chain rewrites.
 */
export function isArtistPath(path: string): boolean {
  return ARTIST_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isLockfile(path: string): boolean {
  return (LOCKFILE_NAMES as readonly string[]).includes(path);
}

/** Paths that never count as a customization: `.github/`, the stamp and lockfiles. */
export function isIgnoredPath(path: string): boolean {
  return path.startsWith(".github/") || path === TEMPLATE_STAMP_PATH || isLockfile(path);
}

/** The parts of a `.stagecraft-template.json` stamp the upgrade reads. */
export interface StampSummary {
  /** Our files and their blob SHAs, or null for a stamp from before the manifest. */
  manifest: CodePathManifest | null;
  packageVersion: string | null;
  createdAt: string | null;
}

/**
 * Read a stamp leniently: a site from before ADR-016 has a stamp with no
 * `manifest` or `packageVersion`, and an artist could have edited it. A
 * missing, unparseable or empty manifest reads as null.
 */
export function readStamp(content: string | null): StampSummary {
  const empty: StampSummary = { manifest: null, packageVersion: null, createdAt: null };
  if (content === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;
  const stamp = parsed as Record<string, unknown>;
  const rawManifest = stamp.manifest;
  const manifest =
    typeof rawManifest === "object" &&
    rawManifest !== null &&
    !Array.isArray(rawManifest) &&
    Object.keys(rawManifest).length > 0 &&
    Object.values(rawManifest).every((sha) => typeof sha === "string")
      ? (rawManifest as CodePathManifest)
      : null;
  return {
    manifest,
    packageVersion: typeof stamp.packageVersion === "string" ? stamp.packageVersion : null,
    createdAt: typeof stamp.createdAt === "string" ? stamp.createdAt : null,
  };
}

/**
 * Whether two package.json texts differ in anything but dependency
 * versions. Merged Dependabot PRs bump versions, which isn't a
 * customization; adding or removing a dependency, changing where one comes
 * from (a git, file, URL or alias spec, or a dist-tag), or changing a script
 * or any other field, is. Text that doesn't parse is compared as is.
 */
export function packageJsonChangedBeyondVersions(baseline: string, current: string): boolean {
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(baseline);
    b = JSON.parse(current);
  } catch {
    return baseline !== current;
  }
  return JSON.stringify(withoutDependencyVersions(a)) !== JSON.stringify(withoutDependencyVersions(b));
}

/**
 * Whether a dependency spec is a registry version or range (`1.2.3`,
 * `^15.2.0`, `~4.0`, `>=1 <2`, `1.x`, `*`), the kind Dependabot bumps,
 * rather than a git, file, URL or `npm:` alias spec, or a dist-tag.
 */
export function isVersionSpec(spec: unknown): boolean {
  if (typeof spec !== "string") return false;
  const trimmed = spec.trim();
  if (trimmed === "*" || trimmed === "") return true;
  return !/[:/#]/.test(trimmed) && /^(?:[\^~]|[<>]=?|=)?\s*v?\d/.test(trimmed);
}

/** A placeholder for a version spec, so a bump compares equal to the original. */
const VERSION_SPEC = "<version>";

/**
 * `pkg` with each dependency map's version specs replaced by a placeholder
 * (other specs kept as they are), and keys sorted.
 */
function withoutDependencyVersions(pkg: unknown): unknown {
  if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) return pkg;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(pkg).sort()) {
    const value = (pkg as Record<string, unknown>)[key];
    out[key] =
      (DEPENDENCY_FIELDS as readonly string[]).includes(key) && typeof value === "object" && value !== null
        ? Object.keys(value)
            .sort()
            .map((name) => {
              const spec = (value as Record<string, unknown>)[name];
              return [name, isVersionSpec(spec) ? VERSION_SPEC : spec];
            })
        : value;
  }
  return out;
}

/** The baseline the artist's changes are measured from. */
export interface Baseline {
  /** Our files at the baseline, path → blob SHA. */
  files: CodePathManifest;
  /** Which paths are checked for changes: `files` plus any added code path. */
  inScope: (path: string) => boolean;
}

/**
 * The baseline for a site whose stamp has a manifest: every file in it is
 * ours and checked, as is any file added under our code paths.
 */
export function manifestBaseline(manifest: CodePathManifest): Baseline {
  return { files: manifest, inScope: (path) => path in manifest || isCodePath(path) };
}

/**
 * The baseline for a site from before the manifest: the template push's
 * tree (`templateTree`, the oldest commit touching `src/lib/`). Only our
 * code paths and package.json are checked (ADR-016 §4), but every file the
 * push wrote that the artist hasn't changed since is ours, and goes when the
 * site moves onto the package. GitHub's `auto_init` README is the artist's.
 */
export function templatePushBaseline(templateTree: ReadonlyMap<string, string>, current: ReadonlyMap<string, string>): Baseline {
  const files: CodePathManifest = {};
  for (const [path, sha] of templateTree) {
    if (isArtistPath(path) || isIgnoredPath(path) || path === AUTO_INIT_README) continue;
    if (isCodePath(path) || path === PACKAGE_JSON || current.get(path) === sha) files[path] = sha;
  }
  return { files, inScope: (path) => isCodePath(path) || path === PACKAGE_JSON };
}

/**
 * Our files the artist changed since `baseline`: changed, deleted, or
 * added under a code path. package.json counts only when something other
 * than dependency versions changed (`packageJsonChangedBeyondVersions`);
 * `.github/`, the stamp and lockfiles never count. Sorted by path.
 */
export async function changedCodeFiles(
  baseline: Baseline,
  current: ReadonlyMap<string, string>,
  readBlob: (sha: string) => Promise<string>,
): Promise<string[]> {
  const paths = new Set([...Object.keys(baseline.files), ...current.keys()]);
  const changed: string[] = [];
  for (const path of [...paths].sort()) {
    if (!baseline.inScope(path) || isIgnoredPath(path) || isArtistPath(path)) continue;
    const before = baseline.files[path];
    const after = current.get(path);
    if (before === after) continue;
    if (path === PACKAGE_JSON && before && after) {
      const [a, b] = await Promise.all([readBlob(before), readBlob(after)]);
      if (!packageJsonChangedBeyondVersions(a, b)) continue;
    }
    changed.push(path);
  }
  return changed;
}

/** The release a site moves onto: the shell the platform bundles, pinned to it. */
export interface TargetShell {
  packageVersion: string;
  /** The shell's files, its starter content left out (a site keeps its own). */
  files: TemplateFile[];
}

/**
 * The shell in the platform's template bundle, or null while the bundle is
 * a full copy of the template: no release of the package is on npm's
 * `latest` yet, so there's nothing to move a site onto
 * (`scripts/generate-template-bundle.mjs`).
 */
export function targetShell(bundle: TemplateFile[]): TargetShell | null {
  const packageVersion = packageVersionFromFiles(bundle);
  if (!packageVersion) return null;
  return { packageVersion, files: bundle.filter((f) => !isArtistPath(f.path)) };
}

/**
 * The spec the site's package.json pins the package at, as written (an exact
 * release, a range, or anything else npm accepts), or null when it doesn't
 * depend on the package (a site from before ADR-016) or the file is absent or
 * unparseable. Unlike `packageVersionFromFiles` it keeps ranges, so an artist's
 * `^1.2.0` still counts as on 1.2.0.
 */
export function pinnedPackageVersion(packageJson: string | null): string | null {
  if (packageJson === null) return null;
  try {
    const parsed = JSON.parse(packageJson) as { dependencies?: Record<string, unknown> };
    const spec = parsed.dependencies?.[MUSICIAN_SITE_PACKAGE];
    return typeof spec === "string" ? spec : null;
  } catch {
    return null;
  }
}

/**
 * Whether a site pinned to `pinned` may already run `target` or a later
 * release, so an upgrade to `target` could move it back and is skipped.
 * Dependabot merges patch and minor releases on its own and the platform's
 * bundle only moves when it's deployed, so a site can be ahead of the
 * bundle. The stamp isn't read: Dependabot never updates it.
 *
 * A range counts when it admits `target` or anything later (`^1.0.0`
 * against 1.1.0 does): without a lockfile the host installs the newest
 * release the range admits, which `target`, being published, bounds from
 * below; with one, the site may still run an older release, and the
 * upgrade waits for Dependabot rather than risk a downgrade. Compound and
 * partial ranges (`>=1.2.0 <2.0.0`, `1.2.x`, `^1.2`) read the same way. A
 * prerelease is behind the release it precedes. A pin that isn't a version
 * or range (a dist-tag, a git spec) only matches itself.
 */
export function isOnOrPastRelease(pinned: string | null, target: string): boolean {
  if (pinned === null) return false;
  const range = semver.validRange(pinned);
  if (range === null || semver.valid(target) === null) return pinned.trim() === target;
  return semver.intersects(range, `>=${target}`, { includePrerelease: true });
}

/**
 * The files an upgrade deletes from `current`: every code path, every
 * lockfile, and every file of ours in the baseline, apart from what the
 * upgrade writes back. The artist's paths and `.github/` stay.
 */
export function upgradeDeletions(
  current: ReadonlyMap<string, string>,
  baseline: Baseline,
  writes: readonly TemplateFile[],
): string[] {
  const written = new Set(writes.map((f) => f.path));
  return [...current.keys()]
    .filter((path) => !written.has(path) && !isArtistPath(path))
    .filter(
      (path) =>
        isCodePath(path) || isLockfile(path) || (path in baseline.files && !isIgnoredPath(path)),
    )
    .sort();
}

/**
 * The shell files an upgrade writes over a file the site has and that isn't
 * ours as the baseline left it: the artist edited it (on a site without a
 * manifest only code paths and package.json are checked, ADR-016 §4), or
 * added it. The pull request lists them, so the artist can carry their
 * change over. Sorted by path.
 */
export function overwrittenFiles(
  current: ReadonlyMap<string, string>,
  baseline: Baseline,
  shellFiles: readonly TemplateFile[],
): string[] {
  return shellFiles
    .filter((file) => {
      const sha = current.get(file.path);
      // package.json either changed beyond versions (a customization, so no
      // upgrade) or only by Dependabot's bumps, which the shell's pins replace.
      if (file.path === PACKAGE_JSON || isIgnoredPath(file.path)) return false;
      return sha !== undefined && sha !== gitBlobSha(file.content) && sha !== baseline.files[file.path];
    })
    .map((file) => file.path)
    .sort();
}

/** The manifest an upgrade records: the shell it writes (ADR-016 §4). */
export function upgradeManifest(shell: TargetShell): CodePathManifest {
  return codePathManifest(shell.files);
}

/** Whether a branch is a CMS draft branch (`draft`, or `draft-<editorKey>`). */
export function isDraftBranch(name: string): boolean {
  return name === "draft" || name.startsWith("draft-");
}

/** Whether `path` is a collection definition the upgrader chain reads. */
export function isCollectionFile(path: string): boolean {
  return COLLECTION_FILE.test(path);
}

/** Why an upgrade can't produce the content the target release reads. */
export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly target: number) {
    super(
      `The target release reads collection schemaVersion ${target}, but the platform's upgraders go up to ` +
        `${LATEST_SCHEMA_VERSION}. Deploy a platform with the newer @jclaw-labs/content-upgraders first.`,
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}

/**
 * The collection definitions among `files` that the upgrader chain
 * rewrites to reach `target`, with their new content. A file already at
 * `target` or newer, without an integer `schemaVersion`, or that doesn't
 * parse is left alone: the site's reader reports those. Throws
 * UnsupportedSchemaVersionError when `target` is past the chain.
 */
export function migrateCollections(files: readonly TemplateFile[], target: number): TemplateFile[] {
  if (!Number.isInteger(target) || target < OLDEST_SCHEMA_VERSION || target > LATEST_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(target);
  }
  const rewritten: TemplateFile[] = [];
  for (const file of files) {
    if (!isCollectionFile(file.path)) continue;
    let collection: CollectionJson;
    try {
      collection = JSON.parse(file.content) as CollectionJson;
    } catch {
      continue;
    }
    const version = collection?.schemaVersion;
    if (typeof version !== "number" || !Number.isInteger(version)) continue;
    if (version < OLDEST_SCHEMA_VERSION || version >= target) continue;
    rewritten.push({ path: file.path, content: JSON.stringify(upgradeCollection(collection, target), null, 2) + "\n" });
  }
  return rewritten;
}

/** The npm registry the target release's metadata is read from. */
export const NPM_REGISTRY = "https://registry.npmjs.org";

/**
 * The collection `schemaVersion` a release of the package reads: its
 * package.json's `stagecraft.schemaVersion`, from the registry's metadata
 * for that version (ADR-016 §4). Throws when the registry can't be read or
 * the release carries no such field.
 */
export async function fetchTargetSchemaVersion(
  packageVersion: string,
  { fetchImpl = fetch, registry = NPM_REGISTRY }: { fetchImpl?: typeof fetch; registry?: string } = {},
): Promise<number> {
  const url = `${registry}/${MUSICIAN_SITE_PACKAGE.replace("/", "%2f")}/${encodeURIComponent(packageVersion)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Reading ${MUSICIAN_SITE_PACKAGE}@${packageVersion} from ${url} failed with HTTP ${res.status}`);
  const manifest = (await res.json()) as { stagecraft?: { schemaVersion?: unknown } };
  const schemaVersion = manifest.stagecraft?.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    throw new Error(`${MUSICIAN_SITE_PACKAGE}@${packageVersion} has no stagecraft.schemaVersion in its package.json`);
  }
  return schemaVersion;
}

const UPGRADE_COMMIT_PREFIX = `Move this site onto ${MUSICIAN_SITE_PACKAGE}@`;

export function upgradeCommitMessage(packageVersion: string): string {
  return `${UPGRADE_COMMIT_PREFIX}${packageVersion}`;
}

/** Whether a commit message is one `upgradeCommitMessage` wrote. */
export function isUpgradeCommitMessage(message: string): boolean {
  return message.startsWith(UPGRADE_COMMIT_PREFIX) && !message.slice(UPGRADE_COMMIT_PREFIX.length).includes("\n");
}

export function upgradePullRequestTitle(packageVersion: string): string {
  return `Upgrade to ${MUSICIAN_SITE_PACKAGE} ${packageVersion}`;
}

/**
 * The upgrade pull request's description, for the artist reviewing it.
 * It asks them to publish pending edits before merging when the upgrade
 * rewrites content (ADR-016 §4: a draft can still change an affected file
 * while the pull request is open).
 */
export function upgradePullRequestBody(args: {
  packageVersion: string;
  deletedCount: number;
  migratedFiles: readonly string[];
  addsWorkflow: boolean;
  removesLockfile: boolean;
  overwrittenFiles?: readonly string[];
}): string {
  const lines = [
    `This pull request moves your site onto **${MUSICIAN_SITE_PACKAGE} ${args.packageVersion}**, the package that now holds the site's code. Stagecraft opened it; nothing merges until you do.`,
    "",
    "What changes:",
    "",
    `- The site's code moves into the package. ${args.deletedCount} file${args.deletedCount === 1 ? "" : "s"} of Stagecraft's code ${args.deletedCount === 1 ? "is" : "are"} deleted, and a small set of shell files that load the package take ${args.deletedCount === 1 ? "its" : "their"} place.`,
    `- \`package.json\` depends on the package at exactly ${args.packageVersion}, and \`${TEMPLATE_STAMP_PATH}\` records that version.`,
    `- Dependabot keeps the package and the site's other dependencies up to date. Patch and minor releases merge on their own once the site still builds.${args.addsWorkflow ? ` This adds the workflow that does that (\`${SITE_AUTOMERGE_WORKFLOW_PATH}\`), which your repository didn't have.` : ""}`,
  ];
  if (args.removesLockfile) {
    lines.push("- The committed lockfile is deleted, so the site builds the same way as every new Stagecraft site.");
  }
  lines.push("- Your content (`src/content/`) and images (`public/images/`) stay as they are.");
  const overwritten = args.overwrittenFiles ?? [];
  if (overwritten.length > 0) {
    lines.push(
      "",
      `${overwritten.length === 1 ? "This file was" : "These files were"} changed in your repository, and the package's version replaces ${overwritten.length === 1 ? "it" : "them"}. If you still need your change, add it back on this branch before you merge:`,
      "",
      ...overwritten.map((path) => `- \`${path}\``),
    );
  }
  if (args.migratedFiles.length > 0) {
    lines.push(
      "",
      `This release reads a newer content format, so ${args.migratedFiles.length === 1 ? "this file is" : "these files are"} rewritten:`,
      "",
      ...args.migratedFiles.map((path) => `- \`${path}\``),
      "",
      "**Before you merge, publish or discard any edits waiting in the site's editor.** An edit to one of these files that's still unpublished would conflict with this change.",
    );
  }
  lines.push(
    "",
    "Your host builds a preview of this branch. Check the preview, then merge. Running the upgrade again from Stagecraft updates this pull request rather than opening another.",
  );
  return lines.join("\n") + "\n";
}
