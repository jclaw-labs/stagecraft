/**
 * Helpers shared between `/api/welcome/complete` and `/api/welcome/reset`.
 *
 * Both routes build a singleton item from an existing-or-null base + a
 * fresh values map (preserving `id` / `createdAt` when possible so the
 * publish history is clean). Shaping the item into a publish target is
 * `planItemWrite` in `@/lib/save-content`, which also validates it.
 */

import {
  generateItemId,
  SINGLETON_ITEM_SLUG,
  type Item,
} from "@/lib/collections";

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
