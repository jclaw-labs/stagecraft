/**
 * Helpers shared between `/api/welcome/complete` and `/api/welcome/reset`.
 *
 * Both routes do the same two things: build a singleton item from
 * an existing-or-null base + a fresh values map (preserving `id` /
 * `createdAt` when possible so the publish history is clean), and
 * shape an `Item` into a `collection-item` publish target. The two
 * helpers were duplicated verbatim across the routes before this
 * extraction (CLAUDE.md §2 DRY).
 */

import {
  generateItemId,
  SINGLETON_ITEM_SLUG,
  type Item,
} from "@/lib/collections";
import type { PublishTarget } from "@/lib/publish";

/**
 * Merge a fresh `values` map into an existing singleton item, or
 * synthesise a brand-new shell when none exists. The on-disk
 * filename for singletons is always `_singleton.json`, so the slug
 * is hard-coded; `id` + `createdAt` are preserved across writes so
 * the per-artist publish history reads cleanly across welcome and
 * reset round-trips.
 */
export function upsertSingletonItem(
  existing: Item | null,
  values: Item["values"],
): Item {
  const now = new Date().toISOString();
  if (existing) {
    return {
      ...existing,
      slug: SINGLETON_ITEM_SLUG,
      updatedAt: now,
      values,
    };
  }
  return {
    id: generateItemId(),
    slug: SINGLETON_ITEM_SLUG,
    createdAt: now,
    updatedAt: now,
    values,
  };
}

/**
 * Build a `collection-item` PublishTarget from an in-hand Item. The
 * publish layer reconstructs the on-disk JSON from the target's
 * `data` shape, so we copy the shape directly rather than re-reading
 * from disk.
 */
export function publishItemTarget(
  collectionSlug: string,
  itemSlug: string,
  item: Item,
): PublishTarget {
  return {
    kind: "collection-item",
    collectionSlug,
    itemSlug,
    data: {
      id: item.id,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      values: item.values,
    },
  };
}
