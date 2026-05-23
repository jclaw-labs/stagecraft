/**
 * Client-safe slice of the draft-changes utilities.
 *
 * `draft-changes.ts` imports Octokit (server-only), so a "use client"
 * component can't pull helpers from it without dragging the GitHub SDK
 * into the browser bundle. This module holds the one piece both sides
 * need — the per-collection row filter — with no node imports, so the
 * Pages panel (client) and the generic collection list (server) badge
 * rows from the exact same logic.
 *
 * The parameter is typed structurally rather than as `DraftChange[]`
 * on purpose: the server caller passes a real `DraftChange[]` (which
 * is assignable to this shape), while the Pages panel passes the
 * parsed — and therefore unvalidated — JSON body from
 * `/api/draft-changes`. A loose shape is the honest type for data
 * that arrives both ways.
 */

/** Minimal projection of a `DraftChange` this filter reads. */
type ChangeLike = {
  kind: string;
  collectionSlug?: string;
  itemSlug?: string;
};

/**
 * Slugs of items in `collectionSlug` that have a pending draft-vs-main
 * change. Only `kind: "item"` changes carry an `itemSlug` and map to a
 * row in a list view; singleton / def / order / image / other changes
 * touch the collection but not a listable item, so they don't badge a
 * row (they still feed the publish modal + the pending count).
 */
export function pendingItemSlugs(
  changes: ReadonlyArray<ChangeLike>,
  collectionSlug: string,
): Set<string> {
  const slugs = new Set<string>();
  for (const change of changes) {
    if (
      change.kind === "item" &&
      change.collectionSlug === collectionSlug &&
      change.itemSlug
    ) {
      slugs.add(change.itemSlug);
    }
  }
  return slugs;
}

/**
 * Whether `collectionSlug`'s singleton has a pending draft-vs-main
 * change — for the custom singleton panels (Site Settings, Header &
 * Navigation, Appearance), which are forms with no row to badge.
 *
 * Matches `kind: "singleton"` only: the artist's form edit writes the
 * one singleton item. A schema (`def`) change is a separate, dev-driven
 * action and shouldn't light up the artist's settings panel as
 * "unpublished".
 */
export function hasPendingSingleton(
  changes: ReadonlyArray<ChangeLike>,
  collectionSlug: string,
): boolean {
  return changes.some(
    (change) => change.kind === "singleton" && change.collectionSlug === collectionSlug,
  );
}
