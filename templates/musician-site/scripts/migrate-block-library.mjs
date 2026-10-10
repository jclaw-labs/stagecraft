/**
 * One-shot content migration for the merged block library (#349).
 *
 * Rewrites the old template-primitive vocabulary (Section narrow / default /
 * wide + padding, Button label, Image src, RichTextRender) into the one block
 * library's, in every collection's templates and every item's puckContent
 * values. The rules live in `src/lib/collections/migrate-block-library.ts`;
 * see it for the mapping and why page bodies come out unchanged.
 *
 *   node scripts/migrate-block-library.mjs [contentDir] [--check]
 *
 * `contentDir` defaults to `$STAGECRAFT_CONTENT_DIR`, then `src/content`.
 * `--check` writes nothing and exits 1 if any file would change.
 * Idempotent: a second run changes nothing.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  migrateCollectionDef,
  migrateItemValues,
} from "../src/lib/collections/migrate-block-library.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const isCheck = args.includes("--check");
const contentDir =
  args.find((a) => !a.startsWith("--")) ??
  process.env.STAGECRAFT_CONTENT_DIR ??
  join(here, "..", "src", "content");

async function listJson(dir) {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
  } catch (cause) {
    if (cause?.code === "ENOENT") return [];
    throw cause;
  }
}

async function migrateFile(path, migrate) {
  const raw = await readFile(path, "utf-8");
  const before = JSON.parse(raw);
  const after = migrate(before);
  if (after === before) return false;
  if (!isCheck) await writeFile(path, JSON.stringify(after, null, 2) + "\n", "utf-8");
  return true;
}

const collectionsDir = join(contentDir, "collections");
const changed = [];
for (const slug of await readdir(collectionsDir)) {
  const defPath = join(collectionsDir, slug, "_collection.json");
  if ((await listJson(join(collectionsDir, slug))).includes(defPath)) {
    if (await migrateFile(defPath, migrateCollectionDef)) changed.push(defPath);
  }
  for (const itemPath of await listJson(join(collectionsDir, slug, "items"))) {
    if (itemPath.endsWith("_order.json")) continue;
    const migrateItem = (item) => {
      const values = migrateItemValues(item.values ?? {});
      return values === item.values ? item : { ...item, values };
    };
    if (await migrateFile(itemPath, migrateItem)) changed.push(itemPath);
  }
}

const verb = isCheck ? "would change" : "changed";
console.log(`${changed.length} file(s) ${verb} under ${contentDir}`);
for (const path of changed) console.log(`  ${relative(contentDir, path)}`);
if (isCheck && changed.length > 0) process.exit(1);
