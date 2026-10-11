/**
 * Build step: bundle the files a new artist site starts with into a JSON
 * module the create_site and migrate_site jobs import.
 *
 * Which files depends on npm (ADR-016 §1, §2). Once a release of
 * `@jclaw-labs/musician-site` is on the `latest` dist-tag, the bundle is the
 * artist-repo shell (`templates/musician-site-shell`), with its `file:`
 * dependency on the package rewritten to that exact version. Until then,
 * or while `latest` points at a prerelease (the registry puts a package's
 * first version on `latest` even when it's published with `--tag rc`), it
 * is a full copy of the
 * template plus the shell's starter content. A generated shell never pins a
 * prerelease: Dependabot keeps offering prereleases to a dependency pinned
 * to one.
 *
 * The jobs used to walk `templates/musician-site` with `fs` at runtime,
 * which only worked because next.config.ts copied the template into the
 * Netlify function bundle. The template is read here at build time instead
 * and shipped as module data, so the jobs don't depend on that copy.
 *
 * Plain .mjs (not .ts) so it runs on any supported Node without a TS
 * loader, before `next build`, `tsc`, and `vitest`.
 *
 * Usage: node scripts/generate-template-bundle.mjs
 *
 * It reads `latest` from the npm registry on every run, and fails rather
 * than guess when the registry can't be reached. Set
 * STAGECRAFT_SITE_PACKAGE_LATEST to skip the lookup: to a version to use it
 * as `latest`, or empty to bundle the full template.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Template source directory (monorepo `templates/musician-site`). */
export const TEMPLATE_DIR = path.resolve(SCRIPT_DIR, "../../../templates/musician-site");

/**
 * The starter content a new site starts with. It lives in the artist-repo
 * shell, `templates/musician-site-shell` (ADR-016 §1), since content is the
 * artist's, not the package's. While new sites get a full copy of the
 * template (nothing on `latest`, see above), the bundle is the template
 * plus this content under `src/content/`.
 */
export const STARTER_CONTENT_DIR = path.resolve(SCRIPT_DIR, "../../../templates/musician-site-shell/src/content");

/** The artist-repo shell (ADR-016 §1): what a site on the package holds. */
export const SHELL_DIR = path.resolve(SCRIPT_DIR, "../../../templates/musician-site-shell");

/**
 * Shell files that exist only so the shell runs from this checkout
 * (`templates/musician-site-shell/CLAUDE.md`). `CLAUDE.md` and
 * `package-lock.json` are in `TEMPLATE_SKIP_FILES` already.
 */
export const SHELL_SKIP_FILES = new Set([".npmrc"]);

/** The registry the shell's package version is looked up on. */
export const NPM_REGISTRY = "https://registry.npmjs.org";

/**
 * Set to the version on `latest` to skip the registry lookup (offline
 * work, or to try the shell bundle before a release). Set it empty to
 * bundle the full template as if nothing were on `latest`.
 */
export const LATEST_OVERRIDE_ENV = "STAGECRAFT_SITE_PACKAGE_LATEST";

/** Where a site keeps its content, relative to the repo root. */
export const SITE_CONTENT_PREFIX = "src/content";

/** Generated module, imported by `src/lib/template-reader.ts`. Gitignored. */
export const TEMPLATE_BUNDLE_FILE = path.resolve(SCRIPT_DIR, "../src/generated/template-bundle.json");

/** Binary file extensions that should not be pushed via the Git Data API. */
export const BINARY_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg",
  ".pdf", ".zip",
]);

/**
 * Directories to skip when walking the template.
 * Defined explicitly rather than parsed from .gitignore to avoid
 * brittleness around .gitignore format changes.
 */
export const TEMPLATE_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  ".git",
  "tests",
  "scripts",
  // Test-only directories (#473). Sites run `next build` and nothing else,
  // so the template's tests and their tooling stay out of site copies.
  "e2e",
  "capture",
  "__snapshots__",
]);

/** Individual files to skip when reading the template. */
export const TEMPLATE_SKIP_FILES = new Set([
  "package-lock.json",
  // The package's release notes and npm readme (ADR-016 §2, §3).
  "CHANGELOG.md",
  "README.md",
  "playwright.config.ts",
  "CLAUDE.md",
  "EDITING.md",
  "tsconfig.build.json",
  "playwright.capture.config.ts",
  "vitest.config.ts",
  "vitest.setup.ts",
  // Fixtures that only the template's unit tests import.
  "test-fixtures.ts",
]);

/**
 * Test and spec files, skipped wherever they sit. They import the test tooling that
 * site copies drop (see `TEST_ONLY_DEV_DEPENDENCIES`), and a site's
 * `next build` type-checks every `.ts` file it has.
 */
export const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;

/**
 * Fields of the template's package.json that only the published npm
 * package (`@jclaw-labs/musician-site`, ADR-016) uses. A site repo is an
 * app, not a package, so they're dropped from its copy.
 */
const PACKAGE_ONLY_FIELDS = ["exports", "files", "bin", "repository", "description"];

/**
 * Scripts a site can't run: the ones that build or guard the published
 * package, the test runners whose tests aren't copied, and the ones that
 * run files from the skipped `scripts/` directory.
 */
const TEMPLATE_ONLY_SCRIPTS = [
  "build:package",
  "prepublishOnly",
  "test",
  "test:e2e",
  "capture:screenshots",
  "refresh:demo",
];

/**
 * Dev dependencies only the template's tests use. Sites don't get the
 * tests, and npm 10.9 (Netlify's npm on Node 22) crashes resolving
 * vitest's peers when there's no lockfile, as in a site repo (#473).
 */
export const TEST_ONLY_DEV_DEPENDENCIES = [
  "@playwright/test",
  "@testing-library/react",
  "@testing-library/user-event",
  "@vitejs/plugin-react",
  "jsdom",
  "vite",
  "vitest",
];

/** An exact semver version, as the package pins its runtime dependencies. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The template's package.json as a site repo needs it. While new sites
 * get a full copy of the template (until a release is on `latest`), each
 * builds from source, so its package.json:
 *
 * - is a private app named `musician-site`, without the publish fields;
 * - drops the test scripts and test-only dev dependencies, since the
 *   tests aren't copied;
 * - lists `next`, `react` and `react-dom` as dependencies, since hosts
 *   detect Next.js from them and the package only declares them as peers;
 * - points each `file:` dependency, which names a monorepo package that
 *   can't install anywhere else, at the copy of its source vendored into
 *   the site (`vendoredPackageFiles`);
 * - turns the package's exact runtime pins back into `^` ranges. Sites
 *   have no lockfile and float to new patch and minor releases on each
 *   host build, as they did before the package pinned them;
 * - points each `imports` default target at `src/`, the `source` target,
 *   since a site has no `dist/`.
 *
 * @param {string} content
 * @returns {string}
 */
export function sitePackageJson(content) {
  const pkg = JSON.parse(content);
  for (const field of PACKAGE_ONLY_FIELDS) delete pkg[field];
  for (const script of TEMPLATE_ONLY_SCRIPTS) delete pkg.scripts?.[script];
  for (const name of TEST_ONLY_DEV_DEPENDENCIES) delete pkg.devDependencies?.[name];
  for (const target of Object.values(pkg.imports ?? {})) {
    if (target && typeof target === "object" && typeof target.source === "string") target.default = target.source;
  }
  const dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies ?? {})
      .map(([name, spec]) => [name, siteDependencySpec(String(spec))]),
  );
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    dependencies[name] = pkg.devDependencies?.[name] ?? range;
    delete pkg.devDependencies?.[name];
  }
  delete pkg.peerDependencies;
  const { name: _name, private: _private, ...rest } = pkg;
  const site = { name: "musician-site", private: true, ...rest };
  site.dependencies = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => (a < b ? -1 : 1)));
  return JSON.stringify(site, null, 2) + "\n";
}

/** Where a site copy vendors the monorepo package a `file:` spec names. */
export const VENDOR_DIR = "vendor";

/** @param {string} spec */
function vendorPath(spec) {
  return `${VENDOR_DIR}/${path.posix.basename(spec.slice("file:".length))}`;
}

/**
 * A dependency spec as the site needs it: `file:` points at the vendored
 * copy, exact pins become `^` ranges, anything else stays.
 *
 * @param {string} spec
 */
function siteDependencySpec(spec) {
  if (spec.startsWith("file:")) return `file:./${vendorPath(spec)}`;
  return EXACT_VERSION.test(spec) ? `^${spec}` : spec;
}

/**
 * The files that vendor the monorepo packages the template depends on
 * through `file:` into a site copy, under `vendor/<directory name>/`.
 * A full copy of the template installs them from its own repo, since it
 * builds from source rather than from the published package. Each gets its `src/` (tests left out) and a
 * package.json whose only export is the TypeScript entry: the site
 * builds it from source, as the template does (`transpilePackages` and
 * the alias in the template's `next.config.ts`).
 *
 * @param {string} templateDir
 * @param {string} templatePackageJson
 * @returns {Promise<Array<{ path: string; content: string }>>}
 */
export async function vendoredPackageFiles(templateDir, templatePackageJson) {
  const { dependencies = {} } = JSON.parse(templatePackageJson);
  /** @type {Array<{ path: string; content: string }>} */
  const files = [];
  /** @type {Map<string, string>} vendor directory -> the spec that claimed it */
  const claimed = new Map();
  for (const spec of Object.values(dependencies).map(String)) {
    if (!spec.startsWith("file:")) continue;
    const dir = vendorPath(spec);
    if (claimed.has(dir)) throw new Error(`"${claimed.get(dir)}" and "${spec}" both vendor to ${dir}/.`);
    claimed.set(dir, spec);
    const packageDir = path.resolve(templateDir, spec.slice("file:".length));
    const pkg = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf-8"));
    const source = pkg.exports?.["."]?.source;
    if (typeof source !== "string") {
      throw new Error(`${pkg.name} has no "source" export to vendor into site copies.`);
    }
    const vendored = { name: pkg.name, version: pkg.version, private: true, type: pkg.type, exports: { ".": source } };
    const prefix = vendorPath(spec);
    files.push({ path: `${prefix}/package.json`, content: JSON.stringify(vendored, null, 2) + "\n" });
    for (const file of await collectTemplateFiles(path.join(packageDir, "src"), { vendor: false })) {
      files.push({ path: `${prefix}/src/${file.path}`, content: file.content });
    }
  }
  return files;
}

/**
 * Walk `dir` and return all non-binary, non-skipped text files, sorted by
 * path, as they sit on disk.
 *
 * @param {string} dir
 * @param {Set<string>} [extraSkipFiles] file names skipped on top of `TEMPLATE_SKIP_FILES`
 * @returns {Promise<Array<{ path: string; content: string }>>}
 */
async function walkTextFiles(dir, extraSkipFiles = new Set()) {
  /** @type {Array<{ path: string; content: string }>} */
  const files = [];

  /** @param {string} current @param {string} prefix */
  async function walk(current, prefix) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (TEMPLATE_SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        if (TEMPLATE_SKIP_FILES.has(entry.name) || extraSkipFiles.has(entry.name) || TEST_FILE.test(entry.name)) continue;
        if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        files.push({ path: relativePath, content: await fs.readFile(fullPath, "utf-8") });
      }
    }
  }

  await walk(dir, "");
  return sortByPath(files);
}

/**
 * @template {{ path: string }} T
 * @param {T[]} files
 * @returns {T[]}
 */
function sortByPath(files) {
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Walk `templateDir` and return all non-binary, non-skipped text files,
 * with the root package.json made a site's (`sitePackageJson`), plus the
 * vendored `file:` packages (`vendoredPackageFiles`), sorted by path so
 * the generated bundle is deterministic.
 *
 * @param {string} templateDir
 * @param {{ vendor?: boolean }} [options]
 * @returns {Promise<Array<{ path: string; content: string }>>}
 */
export async function collectTemplateFiles(templateDir, { vendor = true } = {}) {
  const files = (await walkTextFiles(templateDir)).map((f) =>
    f.path === "package.json" ? { path: f.path, content: sitePackageJson(f.content) } : f,
  );
  if (vendor) {
    const packageJson = await fs.readFile(path.join(templateDir, "package.json"), "utf-8").catch(() => null);
    if (packageJson !== null) files.push(...(await vendoredPackageFiles(templateDir, packageJson)));
  }
  return sortByPath(files);
}

/**
 * The site's files: the template's (`collectTemplateFiles`) plus the
 * starter content under `src/content/`, sorted by path. Refuses a template
 * with no files, one with content of its own (which would collide with
 * the starter content), and missing starter content.
 *
 * @param {string} templateDir
 * @param {string} contentDir
 * @returns {Promise<Array<{ path: string; content: string }>>}
 */
export async function collectSiteFiles(templateDir, contentDir) {
  const template = await collectTemplateFiles(templateDir);
  if (template.length === 0) throw new Error(`No template files found under ${templateDir}`);
  const clash = template.find((f) => f.path.startsWith(`${SITE_CONTENT_PREFIX}/`));
  if (clash) {
    throw new Error(
      `${templateDir} has ${clash.path}; starter content belongs in ${contentDir}. ` +
        "Running the template without STAGECRAFT_CONTENT_DIR writes content there: " +
        `delete ${path.join(templateDir, SITE_CONTENT_PREFIX)} and set STAGECRAFT_CONTENT_DIR when you run it.`,
    );
  }
  const content = (await collectTemplateFiles(contentDir, { vendor: false })).map((f) => ({
    path: `${SITE_CONTENT_PREFIX}/${f.path}`,
    content: f.content,
  }));
  if (content.length === 0) throw new Error(`No starter content found under ${contentDir}`);
  return sortByPath([...template, ...content]);
}

/** A release version: exact, with no prerelease or build suffix. */
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * The shell's package.json as a site repo needs it: the package pinned to
 * `version` exactly (ADR-016 §3: sites have no lockfile, so a range would
 * skip the Dependabot build gate), and no `overrides`, which only point the
 * package's own `file:` upgraders dependency at the monorepo copy.
 * Refuses a prerelease, and a shell that doesn't depend on the package
 * through `file:`.
 *
 * @param {string} content
 * @param {string} packageName
 * @param {string} version
 * @returns {string}
 */
export function shellSitePackageJson(content, packageName, version) {
  if (!RELEASE_VERSION.test(version)) {
    throw new Error(`Refusing to pin ${packageName} to ${version}: a generated site only pins a release, never a prerelease.`);
  }
  const pkg = JSON.parse(content);
  const spec = pkg.dependencies?.[packageName];
  if (typeof spec !== "string" || !spec.startsWith("file:")) {
    throw new Error(`The shell's package.json must depend on ${packageName} through file:, not ${JSON.stringify(spec)}.`);
  }
  pkg.dependencies[packageName] = version;
  delete pkg.overrides;
  return JSON.stringify(pkg, null, 2) + "\n";
}

/**
 * The files of a site on the package: the shell's, without its
 * monorepo-only files, and with its package.json pinned to `version`
 * (`shellSitePackageJson`). The starter content is already in the shell's
 * `src/content/`. Refuses a shell without a package.json or starter content.
 *
 * @param {string} shellDir
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<Array<{ path: string; content: string }>>}
 */
export async function collectShellFiles(shellDir, packageName, version) {
  const files = await walkTextFiles(shellDir, SHELL_SKIP_FILES);
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) throw new Error(`No package.json found under ${shellDir}`);
  pkg.content = shellSitePackageJson(pkg.content, packageName, version);
  if (!files.some((f) => f.path.startsWith(`${SITE_CONTENT_PREFIX}/`))) {
    throw new Error(`No starter content found under ${path.join(shellDir, SITE_CONTENT_PREFIX)}`);
  }
  return files;
}

/**
 * The version on the package's `latest` dist-tag, or null when the package
 * isn't on the registry or has no `latest`.
 *
 * @param {string} packageName
 * @param {{ fetchImpl?: typeof fetch; registry?: string }} [options]
 * @returns {Promise<string | null>}
 */
export async function fetchLatestVersion(packageName, { fetchImpl = fetch, registry = NPM_REGISTRY } = {}) {
  // The abbreviated packument: the registry answers 404 for a package it
  // doesn't have here, where the dist-tags endpoint answers 401.
  const url = `${registry}/${packageName.replace("/", "%2f")}`;
  const res = await fetchImpl(url, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Reading ${packageName}'s dist-tags from ${url} failed with HTTP ${res.status}. ` +
        `Set ${LATEST_OVERRIDE_ENV} to bundle without the registry.`,
    );
  }
  const latest = (await res.json())?.["dist-tags"]?.latest;
  return typeof latest === "string" ? latest : null;
}

/**
 * Which version of the package new sites pin, given what's on `latest`:
 * that version when it's a release, or null (bundle the full template)
 * when nothing is on `latest` or it's a prerelease.
 *
 * @param {string} packageName
 * @param {string | null} latest
 * @returns {{ version: string | null; reason: string }}
 */
export function sitePackageVersion(packageName, latest) {
  if (!latest) return { version: null, reason: `no ${packageName} release is on latest` };
  if (!RELEASE_VERSION.test(latest)) {
    return { version: null, reason: `refusing ${packageName}@${latest} on latest: it's a prerelease` };
  }
  return { version: latest, reason: `${packageName}@${latest} is on latest` };
}

/**
 * Resolve the version new sites pin: from `LATEST_OVERRIDE_ENV` when set,
 * otherwise the registry's `latest` dist-tag (`fetchLatestVersion`).
 *
 * @param {{ templateDir?: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ packageName: string; version: string | null; reason: string }>}
 */
export async function resolveSitePackageVersion({ templateDir = TEMPLATE_DIR, env = process.env, fetchImpl } = {}) {
  const { name: packageName } = JSON.parse(await fs.readFile(path.join(templateDir, "package.json"), "utf-8"));
  const override = env[LATEST_OVERRIDE_ENV];
  const latest = override !== undefined ? override.trim() || null : await fetchLatestVersion(packageName, { fetchImpl });
  return { packageName, ...sitePackageVersion(packageName, latest) };
}

/**
 * Collect the site's files and write them to `outFile` as a JSON array of
 * `{ path, content }`: the shell pinned to `sitePackage.version`
 * (`collectShellFiles`) when there is one, otherwise the full template
 * (`collectSiteFiles`). Returns the file count and raw / gzipped sizes.
 *
 * @param {{
 *   templateDir?: string;
 *   contentDir?: string;
 *   shellDir?: string;
 *   outFile?: string;
 *   sitePackage?: { packageName: string; version: string | null };
 * }} [options]
 * @returns {Promise<{ fileCount: number; bytes: number; gzipBytes: number }>}
 */
export async function generateTemplateBundle({
  templateDir = TEMPLATE_DIR,
  contentDir = STARTER_CONTENT_DIR,
  shellDir = SHELL_DIR,
  outFile = TEMPLATE_BUNDLE_FILE,
  sitePackage = { packageName: "", version: null },
} = {}) {
  const files = sitePackage.version
    ? await collectShellFiles(shellDir, sitePackage.packageName, sitePackage.version)
    : await collectSiteFiles(templateDir, contentDir);
  const json = JSON.stringify(files);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  // Write then rename, so a build reading the bundle never sees a half-written file.
  const tmpFile = `${outFile}.${process.pid}.tmp`;
  await fs.writeFile(tmpFile, json);
  await fs.rename(tmpFile, outFile);
  const buf = Buffer.from(json, "utf-8");
  return { fileCount: files.length, bytes: buf.length, gzipBytes: gzipSync(buf).length };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const sitePackage = await resolveSitePackageVersion();
  const { fileCount, bytes, gzipBytes } = await generateTemplateBundle({ sitePackage });
  const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;
  const source = sitePackage.version ? `the shell on ${sitePackage.packageName}@${sitePackage.version}` : "the full template";
  console.log(
    `template bundle: ${source} (${sitePackage.reason}), ${fileCount} files, ${kb(bytes)} raw, ${kb(gzipBytes)} gzipped → ${path.relative(process.cwd(), TEMPLATE_BUNDLE_FILE)}`,
  );
}
