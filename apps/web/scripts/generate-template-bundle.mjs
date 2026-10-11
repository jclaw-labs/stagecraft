/**
 * Build step: bundle the musician-site template's text files into a JSON
 * module the create_site and migrate_site jobs import.
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
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Template source directory (monorepo `templates/musician-site`). */
export const TEMPLATE_DIR = path.resolve(SCRIPT_DIR, "../../../templates/musician-site");

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
 * The template's package.json as a site repo needs it. Until sites move
 * onto the published package (ADR-016 §4, #422), each site is a full copy
 * of the template and builds from source, so its package.json:
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
 * Until those packages are published (ADR-016 §2, #422), a site installs
 * them from its own repo. Each gets its `src/` (tests left out) and a
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
  for (const spec of Object.values(dependencies).map(String)) {
    if (!spec.startsWith("file:")) continue;
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
 * Walk `templateDir` and return all non-binary, non-skipped text files,
 * plus the vendored `file:` packages (`vendoredPackageFiles`), sorted by
 * path so the generated bundle is deterministic.
 *
 * @param {string} templateDir
 * @param {{ vendor?: boolean }} [options]
 * @returns {Promise<Array<{ path: string; content: string }>>}
 */
export async function collectTemplateFiles(templateDir, { vendor = true } = {}) {
  /** @type {Array<{ path: string; content: string }>} */
  const files = [];

  /** @param {string} dir @param {string} prefix */
  async function walk(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (TEMPLATE_SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        if (TEMPLATE_SKIP_FILES.has(entry.name) || TEST_FILE.test(entry.name)) continue;
        if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        const content = await fs.readFile(fullPath, "utf-8");
        files.push({ path: relativePath, content: relativePath === "package.json" ? sitePackageJson(content) : content });
      }
    }
  }

  await walk(templateDir, "");
  if (vendor) {
    const packageJson = await fs.readFile(path.join(templateDir, "package.json"), "utf-8").catch(() => null);
    if (packageJson !== null) files.push(...(await vendoredPackageFiles(templateDir, packageJson)));
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Collect the template and write it to `outFile` as a JSON array of
 * `{ path, content }`. Returns the file count and raw / gzipped sizes.
 *
 * @param {{ templateDir?: string; outFile?: string }} [options]
 * @returns {Promise<{ fileCount: number; bytes: number; gzipBytes: number }>}
 */
export async function generateTemplateBundle({
  templateDir = TEMPLATE_DIR,
  outFile = TEMPLATE_BUNDLE_FILE,
} = {}) {
  const files = await collectTemplateFiles(templateDir);
  if (files.length === 0) {
    throw new Error(`No template files found under ${templateDir}`);
  }
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
  const { fileCount, bytes, gzipBytes } = await generateTemplateBundle();
  const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(
    `template bundle: ${fileCount} files, ${kb(bytes)} raw, ${kb(gzipBytes)} gzipped → ${path.relative(process.cwd(), TEMPLATE_BUNDLE_FILE)}`,
  );
}
