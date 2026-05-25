/**
 * Template file reader — shared between create-site and migrate-site jobs.
 *
 * Reads all text files from a site template directory, skipping
 * binary files, build artifacts, and files that should not be committed.
 *
 * Skip directories are defined explicitly rather than parsed from .gitignore
 * to avoid brittleness around .gitignore format changes.
 */

import fs from "fs/promises";
import path from "path";

/** Binary file extensions that should not be pushed via the Git Data API. */
export const BINARY_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg",
  ".pdf", ".zip",
]);

/**
 * Directories to skip when walking the template.
 * Defined explicitly rather than parsed from .gitignore.
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

export type TemplateFile = { path: string; content: string };

/**
 * Walk `templateDir` and return all non-binary, non-skipped text files.
 *
 * Pass an optional `transform` callback to modify a file's content before
 * it's included — useful for injecting site-specific values into config files.
 */
export async function readTemplateFiles(
  templateDir: string,
  transform?: (relativePath: string, content: string) => string
): Promise<TemplateFile[]> {
  const files: TemplateFile[] = [];

  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (TEMPLATE_SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        if (TEMPLATE_SKIP_FILES.has(entry.name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;

        let content = await fs.readFile(fullPath, "utf-8");
        if (transform) content = transform(relativePath, content);
        files.push({ path: relativePath, content });
      }
    }
  }

  await walk(templateDir, "");
  return files;
}
