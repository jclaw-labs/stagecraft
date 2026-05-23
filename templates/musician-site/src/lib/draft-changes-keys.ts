import { type DraftChange } from "./draft-changes";

/**
 * Stable identity for a pending change, used to map a publish-modal
 * selection back to the diff server-side (ADR-012, per-item Publish).
 *
 * Lives in its own node-import-free module — it imports only the
 * `DraftChange` *type* (erased at build) — so a `"use client"` file (the
 * publish modal) can import it without dragging `draft-changes.ts`'s
 * server-only deps (octokit / `next/headers`) into the client bundle.
 * Same client-safe-sibling pattern as `filter-schema.ts` / `field-ids.ts`.
 *
 * Image variants all collapse to one key (`image:<contentSlug>/<imageId>`),
 * so selecting an image selects its whole variant set.
 */
export function changeKey(change: DraftChange): string {
  switch (change.kind) {
    case "item":
      return `item:${change.collectionSlug}/${change.itemSlug}`;
    case "singleton":
      return `singleton:${change.collectionSlug}`;
    case "def":
      return `def:${change.collectionSlug}`;
    case "order":
      return `order:${change.collectionSlug}`;
    case "image":
      return `image:${change.contentSlug}/${change.imageId}`;
    case "other":
      return `other:${change.path}`;
  }
}
