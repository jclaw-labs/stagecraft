/**
 * Filesystem layer for the Collection abstraction.
 *
 * Layout on disk (mirrors ADR-009 §7):
 *
 *   src/content/collections/<collection-slug>/
 *     _collection.json                    # CollectionDef
 *     items/
 *       _order.json                       # OPTIONAL — manual ordering only
 *       _singleton.json                   # OPTIONAL — singletons only
 *       <item-slug>.json                  # one regular item per file
 *
 * Paths flow repo → local via `localPathForRepoPath` (shared with the
 * publish layer) so the on-disk root resolves the same way in both
 * places. JSON read/write goes through `readJson` / `writeJson` so
 * formatting stays canonical (see `fs-helpers.ts`). Validation runs on
 * both read and write so corrupt data surfaces loudly rather than
 * silently propagating.
 */

import type { z } from "zod";

import {
  localPathForRepoPath,
  readdirFiltered,
  readJson,
  unlinkIfExists,
  writeJson,
} from "../fs-helpers";

import {
  buildItemFileSchema,
  collectionDefSchema,
  itemSlugSchema,
  orderFileSchema,
  slugSchema,
  ORDER_FILE_NAME,
  SINGLETON_ITEM_SLUG,
  type CollectionDef,
  type Item,
  type ItemFile,
} from "./schema";
import { scalarSortKey } from "./sort-key";

// ---------------------------------------------------------------------------
// Paths
//
// Repo paths (relative to repo root) are the source of truth. Local
// filesystem paths derive from them via `localPathForRepoPath`, which
// honours `STAGECRAFT_CONTENT_DIR` so test workers stay isolated. This
// matches the convention publish.ts uses for the same `src/content/...`
// → on-disk mapping.
// ---------------------------------------------------------------------------

const COLLECTIONS_REPO_ROOT = "src/content/collections";

const collectionRepoDir = (s: string) => `${COLLECTIONS_REPO_ROOT}/${s}`;
const itemsRepoDir = (s: string) => `${collectionRepoDir(s)}/items`;

export const collectionDefRepoPath = (s: string) => `${collectionRepoDir(s)}/_collection.json`;
export const itemRepoPath = (s: string, i: string) => `${itemsRepoDir(s)}/${i}.json`;
export const orderRepoPath = (s: string) => `${itemsRepoDir(s)}/${ORDER_FILE_NAME}.json`;

const collectionsLocalDir = () => localPathForRepoPath(COLLECTIONS_REPO_ROOT);
const itemsLocalDir = (s: string) => localPathForRepoPath(itemsRepoDir(s));
const collectionDefLocalPath = (s: string) => localPathForRepoPath(collectionDefRepoPath(s));
const itemLocalPath = (s: string, i: string) => localPathForRepoPath(itemRepoPath(s, i));
const orderLocalPath = (s: string) => localPathForRepoPath(orderRepoPath(s));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ItemExistsError extends Error {
  constructor(
    public collectionSlug: string,
    public itemSlug: string,
  ) {
    super(`An item with slug "${itemSlug}" already exists in collection "${collectionSlug}"`);
    this.name = "ItemExistsError";
  }
}

// ---------------------------------------------------------------------------
// Collection-level operations
// ---------------------------------------------------------------------------

export async function listCollectionSlugs(): Promise<string[]> {
  return readdirFiltered(collectionsLocalDir(), (e) =>
    e.isDirectory() && slugSchema.safeParse(e.name).success ? e.name : null,
  );
}

export async function readCollectionDef(
  collectionSlug: string,
): Promise<CollectionDef | null> {
  slugSchema.parse(collectionSlug);
  const raw = await readJson<unknown>(collectionDefLocalPath(collectionSlug));
  return raw === null ? null : collectionDefSchema.parse(raw);
}

export async function writeCollectionDef(
  collectionSlug: string,
  def: CollectionDef,
): Promise<void> {
  slugSchema.parse(collectionSlug);
  if (def.slug !== collectionSlug) {
    throw new Error(
      `writeCollectionDef: def.slug (${def.slug}) must match target slug (${collectionSlug})`,
    );
  }
  await writeJson(collectionDefLocalPath(collectionSlug), collectionDefSchema.parse(def));
}

// ---------------------------------------------------------------------------
// Item operations
// ---------------------------------------------------------------------------

/**
 * Walk `items/` and return the slugs of every regular item file. Reserved
 * filenames (`_singleton`, `_order`) are excluded by `slugSchema`'s
 * leading-underscore rejection.
 */
export async function listItemSlugs(collectionSlug: string): Promise<string[]> {
  slugSchema.parse(collectionSlug);
  return readdirFiltered(itemsLocalDir(collectionSlug), (e) => {
    if (!e.isFile() || !e.name.endsWith(".json")) return null;
    const slug = e.name.replace(/\.json$/, "");
    return slugSchema.safeParse(slug).success ? slug : null;
  });
}

/**
 * Read one item by slug. Validates the on-disk file against the
 * collection's current schema; throws on schema mismatch so corrupt
 * data is surfaced rather than silently propagating.
 *
 * Takes the collection def as an argument (rather than reading it
 * here) so callers can amortise the def read across many item reads.
 * For bulk reads (e.g. `listItemsInOrder`), prefer the internal
 * `readItemWithSchema` and build the per-item Zod schema once — see
 * the comment on `readItemWithSchema`.
 */
export async function readItem(
  collectionSlug: string,
  itemSlug: string,
  def: CollectionDef,
): Promise<Item | null> {
  return readItemWithSchema(collectionSlug, itemSlug, buildItemFileSchema(def.fields));
}

/**
 * Internal: read an item against a pre-built file schema. The schema
 * builder walks `def.fields` and assembles a Zod object per call; for
 * a 500-item collection that's 500 identical schema constructions.
 * Listing flows build the schema once and reuse it across reads.
 */
async function readItemWithSchema(
  collectionSlug: string,
  itemSlug: string,
  fileSchema: z.ZodType<ItemFile>,
): Promise<Item | null> {
  slugSchema.parse(collectionSlug);
  itemSlugSchema.parse(itemSlug);
  const raw = await readJson<unknown>(itemLocalPath(collectionSlug, itemSlug));
  if (raw === null) return null;
  const file = fileSchema.parse(raw);
  // The on-disk file omits the slug — derive it from the filename so
  // renames are a single fs operation, not a content edit.
  return { ...file, slug: itemSlug };
}

/**
 * Write an item. Validates against the collection's schema and ensures
 * the item's own `slug` matches the target slug (which becomes the
 * filename).
 *
 * **System-owned timestamps.** `updatedAt` is always set to "now" by
 * this function regardless of the caller-supplied value. `createdAt`
 * is preserved from the caller (and from any existing item file —
 * the typical pattern is to read an item, mutate values, and pass it
 * back here). Use `createItem` for first-time creation so `createdAt`
 * gets set to now as well.
 */
export async function writeItem(
  collectionSlug: string,
  itemSlug: string,
  item: Item,
  def: CollectionDef,
): Promise<void> {
  slugSchema.parse(collectionSlug);
  itemSlugSchema.parse(itemSlug);
  if (item.slug !== itemSlug) {
    throw new Error(
      `writeItem: item.slug (${item.slug}) must match target slug (${itemSlug})`,
    );
  }
  const file: ItemFile = buildItemFileSchema(def.fields).parse({
    id: item.id,
    createdAt: item.createdAt,
    updatedAt: nowIso(),
    values: item.values,
  });
  await writeJson(itemLocalPath(collectionSlug, itemSlug), file);
}

/** Wall-clock current time as an ISO 8601 string. Extracted for tests. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Create a new item, failing if an item with that slug already exists.
 * Used by API routes that don't want to silently clobber on `POST`.
 *
 * Sets `createdAt` to "now" regardless of the caller-supplied value —
 * "this is a new item" is the source of truth for the timestamp.
 * `writeItem` then sets `updatedAt` to the same instant.
 */
export async function createItem(
  collectionSlug: string,
  itemSlug: string,
  item: Item,
  def: CollectionDef,
): Promise<void> {
  slugSchema.parse(itemSlug); // singleton can't be created via this path
  const existing = await readItem(collectionSlug, itemSlug, def);
  if (existing !== null) {
    throw new ItemExistsError(collectionSlug, itemSlug);
  }
  await writeItem(collectionSlug, itemSlug, { ...item, createdAt: nowIso() }, def);
}

export async function deleteItem(
  collectionSlug: string,
  itemSlug: string,
): Promise<void> {
  slugSchema.parse(collectionSlug);
  itemSlugSchema.parse(itemSlug);
  await unlinkIfExists(itemLocalPath(collectionSlug, itemSlug));
}

/**
 * Rename an item's slug — writes the file at the new path, deletes the
 * old, and updates `_order.json` if manual ordering is in effect.
 *
 * Returns the renamed item as read back from disk (so callers see the
 * canonical `updatedAt` the write stamped). Throws `ItemExistsError`
 * if the new slug collides; throws a plain `Error` if the old item
 * doesn't exist or the slugs are identical.
 *
 * The slug is the on-disk filename; renaming bumps `updatedAt` because
 * `writeItem` always does. Acceptable lie for v1: the alternative is a
 * special-case write path that preserves the timestamp, and the
 * cost-benefit doesn't earn it.
 *
 * Caller is responsible for the publish-layer side (committing the
 * write + delete + order update in one commit). This helper only
 * touches local disk.
 */
export async function renameItem(
  collectionSlug: string,
  oldSlug: string,
  newSlug: string,
  def: CollectionDef,
): Promise<Item> {
  slugSchema.parse(collectionSlug);
  slugSchema.parse(oldSlug);
  slugSchema.parse(newSlug);
  if (oldSlug === newSlug) {
    throw new Error("renameItem: new slug must differ from old");
  }
  const existing = await readItem(collectionSlug, oldSlug, def);
  if (!existing) {
    throw new Error(`renameItem: no item at ${collectionSlug}/${oldSlug}`);
  }
  const collidesWith = await readItem(collectionSlug, newSlug, def);
  if (collidesWith !== null) {
    throw new ItemExistsError(collectionSlug, newSlug);
  }

  const renamed: Item = { ...existing, slug: newSlug };
  await writeItem(collectionSlug, newSlug, renamed, def);
  await deleteItem(collectionSlug, oldSlug);

  // Preserve manual ordering: replace oldSlug with newSlug at its
  // current position so the artist's drag-ordered sequence survives
  // the rename. Field-sorted collections don't care.
  if (def.defaultSort?.mode === "manual") {
    const order = await readOrder(collectionSlug);
    if (order !== null) {
      const updated = order.map((s) => (s === oldSlug ? newSlug : s));
      await writeOrder(collectionSlug, updated);
    }
  }

  const saved = await readItem(collectionSlug, newSlug, def);
  if (!saved) throw new Error("renameItem: rename succeeded but read failed");
  return saved;
}

/**
 * List every item in a collection, respecting the configured ordering:
 *
 *   - `defaultSort = { mode: "manual" }` → use `_order.json`. Items
 *     present on disk but missing from the order file sort to the end
 *     alphabetically. Items in the order file but missing on disk are
 *     filtered out (handles deleted-but-not-yet-pruned-from-order).
 *
 *   - `defaultSort = { mode: "fieldSort", fieldId, direction }` → sort by
 *     the field's value. Items missing the field sort to the end.
 *
 *   - `defaultSort = null` → alphabetic by slug.
 */
export async function listItemsInOrder(
  collectionSlug: string,
  def: CollectionDef,
): Promise<Item[]> {
  const slugs = await listItemSlugs(collectionSlug);
  // Build the per-item Zod schema once and reuse across every read.
  // Rebuilding it inside the readItem loop would walk the field list
  // again for every item — wasted work proportional to N items × F
  // fields.
  const fileSchema = buildItemFileSchema(def.fields);
  const items = (
    await Promise.all(slugs.map((slug) => readItemWithSchema(collectionSlug, slug, fileSchema)))
  ).filter((item): item is Item => item !== null);

  if (def.defaultSort?.mode === "manual") {
    return sortByManualOrder(items, await readOrder(collectionSlug));
  }
  if (def.defaultSort?.mode === "fieldSort") {
    return sortByField(items, def.defaultSort.fieldId, def.defaultSort.direction);
  }
  return items.sort((a, b) => a.slug.localeCompare(b.slug));
}

function sortByManualOrder(items: Item[], order: string[] | null): Item[] {
  if (order === null) return items.sort((a, b) => a.slug.localeCompare(b.slug));
  const orderIndex = new Map(order.map((slug, idx) => [slug, idx] as const));
  return [...items].sort((a, b) => {
    const aIdx = orderIndex.get(a.slug);
    const bIdx = orderIndex.get(b.slug);
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    if (aIdx !== undefined) return -1;
    if (bIdx !== undefined) return 1;
    return a.slug.localeCompare(b.slug);
  });
}

function sortByField(
  items: Item[],
  fieldId: string,
  direction: "asc" | "desc",
): Item[] {
  return [...items].sort((a, b) => {
    const aValue = scalarSortKey(a.values[fieldId]);
    const bValue = scalarSortKey(b.values[fieldId]);
    if (aValue === null && bValue === null) return a.slug.localeCompare(b.slug);
    if (aValue === null) return 1;
    if (bValue === null) return -1;
    const cmp = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    return direction === "asc" ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Ordering (`_order.json`)
// ---------------------------------------------------------------------------

export async function readOrder(collectionSlug: string): Promise<string[] | null> {
  slugSchema.parse(collectionSlug);
  const raw = await readJson<unknown>(orderLocalPath(collectionSlug));
  return raw === null ? null : orderFileSchema.parse(raw);
}

export async function writeOrder(
  collectionSlug: string,
  order: string[],
): Promise<void> {
  slugSchema.parse(collectionSlug);
  await writeJson(orderLocalPath(collectionSlug), orderFileSchema.parse(order));
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

/**
 * Read the single item of a singleton collection. Resolves to the same
 * shape as a regular `readItem`; the only difference is the storage
 * filename. Callers that hit this without the collection being
 * `isSingleton: true` are still served correctly — the function doesn't
 * enforce the flag.
 */
export async function readSingleton(
  collectionSlug: string,
  def: CollectionDef,
): Promise<Item | null> {
  return readItem(collectionSlug, SINGLETON_ITEM_SLUG, def);
}

export async function writeSingleton(
  collectionSlug: string,
  item: Item,
  def: CollectionDef,
): Promise<void> {
  await writeItem(collectionSlug, SINGLETON_ITEM_SLUG, item, def);
}
