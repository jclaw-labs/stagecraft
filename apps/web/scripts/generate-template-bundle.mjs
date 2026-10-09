/**
 * Build step: bundle the musician-site template's text files into a JSON
 * module the create_site and migrate_site jobs import.
 *
 * The jobs used to walk `templates/musician-site` with `fs` at runtime,
 * which only worked because next.config.ts copied the template into the
 * Netlify function bundle. Cloudflare Workers have no filesystem, so the
 * template is read here at build time instead and shipped as module data.
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
]);

/** Individual files to skip when reading the template. */
export const TEMPLATE_SKIP_FILES = new Set([
  "package-lock.json",
  "playwright.config.ts",
  "CLAUDE.md",
  "EDITING.md",
]);

/**
 * Walk `templateDir` and return all non-binary, non-skipped text files,
 * sorted by path so the generated bundle is deterministic.
 *
 * @param {string} templateDir
 * @returns {Promise<Array<{ path: string; content: string }>>}
 */
export async function collectTemplateFiles(templateDir) {
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
        if (TEMPLATE_SKIP_FILES.has(entry.name)) continue;
        if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        files.push({ path: relativePath, content: await fs.readFile(fullPath, "utf-8") });
      }
    }
  }

  await walk(templateDir, "");
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
