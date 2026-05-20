/**
 * Suggest a default URL slug for a draft item in the new-item flow.
 *
 * Default strategy: read the value at `def.slugSourceFieldId` and
 * slugify it. Naive but works for the common case where the slug
 * source is a `text` / `longText` / `select` / `url` / `email` field
 * (the `SLUG_SOURCE_COMPATIBLE_TYPES` set, enforced by
 * `collectionDefSchema.superRefine`).
 *
 * The photos collection is special — it has no text source (image
 * captions are optional + longText, hard to slugify cleanly). For
 * `photos`, we derive from the uploaded image's `contentSlug` plus a
 * short id-hash suffix so multiple uploads to the same content
 * bucket don't collide. Before an image is uploaded we fall back to
 * a `photo-YYYY-MM-DD` shape based on the `takenAt` field (or
 * today's date) so the artist sees SOME suggestion as they fill in
 * the form.
 *
 * Lives in its own file (not in NewItemClient) so the rule has a
 * single home and tests can exercise it directly. Node-import-free —
 * imports types only from schema and the field-id constants from
 * `field-ids.ts`.
 */

import type { CollectionDef, Item } from "./schema";
import { PHOTOS_FIELD_IDS } from "./field-ids";

const SLUG_MAX_LENGTH = 64;

export function suggestSlug(item: Item, def: CollectionDef): string {
  // Photos: derive from the uploaded image (or date-based fallback).
  // Special-cased here rather than threaded through the def because
  // the underlying field-type union doesn't accept `image` as a
  // slug source — slugSourceFieldId stays null on the seed.
  if (def.slug === "photos") {
    return suggestPhotoSlug(item);
  }

  if (!def.slugSourceFieldId) return "";
  const v = item.values[def.slugSourceFieldId];
  if (!v || !("value" in v) || typeof v.value !== "string") return "";
  return slugify(v.value);
}

function suggestPhotoSlug(item: Item): string {
  const imageValue = item.values[PHOTOS_FIELD_IDS.image];
  if (imageValue?.type === "image") {
    const meta = imageValue.value;
    // Short id suffix (first 6 hex chars of the image's SHA hash) so
    // multiple photos under the same content bucket don't collide.
    // The bucket itself ("tour-2026", "site-photos", etc.) carries
    // the meaning; the suffix just disambiguates.
    const idSuffix = meta.id.slice(0, 6);
    return slugify(`${meta.contentSlug}-${idSuffix}`);
  }
  const takenAtValue = item.values[PHOTOS_FIELD_IDS.takenAt];
  const dateString =
    takenAtValue?.type === "date"
      ? takenAtValue.value.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  return `photo-${dateString}`;
}

/**
 * Lowercase, ASCII-ish, hyphens for whitespace and runs of
 * non-slug-safe characters collapsed. Capped at 64 chars to match
 * the `slugSchema` limit.
 */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
}
