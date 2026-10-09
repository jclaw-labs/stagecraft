/**
 * Pre-flight shadowing check for a page slug, shared by page creation
 * (`POST /api/collections/pages/items`) and page rename
 * (`PATCH /api/collections/pages/items/<slug>`).
 *
 * A page's slug is its top-level URL, so it must not shadow a
 * collection's detail URL prefix (`/news`, `/releases`, `/shows`, plus
 * any artist-added custom collection's prefix). Without this check the
 * write succeeds but every later public request throws the
 * routing-conflict error from the catch-all: effectively a full-site
 * outage triggered by a name collision.
 *
 * The defs checked are the union of on-disk defs and the prebaked
 * registry, which covers custom collections and fresh sites where
 * bootstrap hasn't written every prebaked def yet.
 */

import type { ReadStore } from "./read-store";
import { findShadowingPrefix } from "./routing";
import type { CollectionDef } from "./schema";
import { PREBAKED_COLLECTIONS } from "./seeds";

/**
 * Union of every collection def we know about: on-disk defs first
 * (so artist-added custom collections participate), supplemented by
 * any prebaked entry that isn't on disk yet.
 */
async function loadKnownCollectionDefs(store: ReadStore): Promise<CollectionDef[]> {
  const onDiskSlugs = await store.listCollectionSlugs();
  const onDiskDefs = (
    await Promise.all(onDiskSlugs.map((s) => store.readCollectionDef(s)))
  ).filter((d): d is CollectionDef => d !== null);
  const seen = new Set(onDiskDefs.map((d) => d.slug));
  return [
    ...onDiskDefs,
    ...Object.values(PREBAKED_COLLECTIONS).filter((d) => !seen.has(d.slug)),
  ];
}

/**
 * The artist-facing error for a page slug that would shadow a
 * collection prefix, or `null` when the slug is safe to use.
 */
export async function pageSlugShadowError(
  store: ReadStore,
  pageSlug: string,
): Promise<string | null> {
  const shadow = findShadowingPrefix(pageSlug, await loadKnownCollectionDefs(store));
  if (!shadow) return null;
  return `Cannot use slug "${pageSlug}" — it shadows the "${shadow.collectionSlug}" collection's URL prefix "${shadow.detailUrlPrefix}". Pick a different slug.`;
}
