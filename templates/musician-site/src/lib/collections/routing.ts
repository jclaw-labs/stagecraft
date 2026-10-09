/**
 * Public-URL routing for the unified Collection model (ADR-009 §8).
 *
 * A collection's `detailUrlPrefix` decides whether and where its
 * items get public detail pages:
 *
 *   - `"/"`                — items at `/<itemSlug>` (Pages today)
 *   - `"/shows"`           — items at `/shows/<itemSlug>` (tour dates)
 *   - `null`               — no detail pages (still embeddable via
 *                            Collection blocks; items have no URL)
 *
 * Whether a collection has a *list page* at the prefix root (e.g.
 * `/shows` as a list of all tour dates) is independent — it depends
 * on whether `listTemplate` is set. v1 doesn't yet ship list pages
 * for non-Pages collections; the artist creates a Page with a
 * Collection block to fill that role.
 *
 * The pure functions in this module:
 *
 *   - `resolveCollectionItemUrl(segments, defs)` — dispatch. Given the
 *     URL segments and the collection registry, return the collection
 *     + item-slug pair (or null for no match).
 *
 *   - `listPublicRouteSegments(...)` — the inverse, used by the
 *     catch-all's `generateStaticParams`: every URL the public site
 *     prerenders at build time.
 *
 *   - `validateCollectionRouting(defs, pageSlugs)` — checks for two
 *     error classes:
 *       - Multiple collections claiming the same `detailUrlPrefix`
 *       - A Page slug colliding with another collection's prefix root
 *
 * Both classes can corrupt the public site if allowed, so the
 * catch-all's `generateStaticParams` calls `assertCollectionRouting`
 * and a conflict fails `next build` instead of the live site.
 */

import type { CollectionDef } from "./schema";

// ---------------------------------------------------------------------------
// URL → (collection, itemSlug) resolution
// ---------------------------------------------------------------------------

export type ResolvedItemUrl = {
  /** The collection whose detailUrlPrefix matched. */
  collectionSlug: string;
  /** The item slug within that collection. */
  itemSlug: string;
};

/**
 * Resolve a URL to an (item-bearing) collection / item-slug pair.
 *
 * Algorithm (ADR §8):
 *
 *   1. Build the requested path from segments: `"/" + segments.join("/")`.
 *   2. Find the collection with the longest `detailUrlPrefix` that's a
 *      proper prefix of the request (i.e. request starts with prefix
 *      followed by `/`, OR request === prefix + `/<slug>`).
 *   3. The remainder is the item slug.
 *
 * Returns `null` if no collection prefix matches, OR if the matched
 * URL is exactly the prefix (list-page URL, handled separately).
 *
 * Pages with `detailUrlPrefix: "/"` claim everything not under another
 * collection's prefix.
 */
export function resolveCollectionItemUrl(
  segments: ReadonlyArray<string>,
  defs: ReadonlyArray<CollectionDef>,
): ResolvedItemUrl | null {
  if (segments.length === 0) return null; // root URL — handled by the renderer

  const path = "/" + segments.join("/");

  // Sort defs by prefix length descending so the longest match wins.
  // Skip singletons (no public detail pages) and defs with no prefix.
  const routable = defs
    .filter((d) => !d.isSingleton && d.detailUrlPrefix !== null)
    .slice()
    .sort((a, b) => (b.detailUrlPrefix?.length ?? 0) - (a.detailUrlPrefix?.length ?? 0));

  for (const def of routable) {
    const prefix = def.detailUrlPrefix;
    if (prefix === null) continue;

    if (prefix === "/") {
      // Pages-style root prefix. Match if no other (longer) prefix
      // already claimed this URL. Item slug is everything after `/`.
      // Reject paths with embedded slashes — Pages slugs don't carry
      // them, and the multi-segment cases belong to other collections.
      if (segments.length !== 1) continue;
      return { collectionSlug: def.slug, itemSlug: segments[0] };
    }

    if (path === prefix) {
      // Exact prefix match — this is the LIST URL, not a detail URL.
      // Caller decides what to do (404 or listTemplate render); we
      // don't return a (collection, itemSlug) here.
      return null;
    }

    if (path.startsWith(prefix + "/")) {
      const itemSlug = path.slice(prefix.length + 1);
      // Item slug must be a single segment (no further nesting in v1).
      if (itemSlug.includes("/")) continue;
      return { collectionSlug: def.slug, itemSlug };
    }
  }

  return null;
}

/**
 * The public detail URL for one item — the inverse of
 * `resolveCollectionItemUrl`. `null` when the collection has no detail
 * pages (no `detailUrlPrefix`, or a singleton). A Pages-style `/` prefix
 * yields `/<slug>`.
 */
export function itemDetailUrl(
  def: Pick<CollectionDef, "detailUrlPrefix" | "isSingleton">,
  itemSlug: string,
): string | null {
  if (def.isSingleton || def.detailUrlPrefix === null) return null;
  return `${def.detailUrlPrefix.replace(/\/+$/, "")}/${itemSlug}`;
}

// ---------------------------------------------------------------------------
// Build / startup conflict detection
// ---------------------------------------------------------------------------

export type RoutingConflict =
  | {
      kind: "duplicate-detail-url-prefix";
      detailUrlPrefix: string;
      collectionSlugs: string[];
    }
  | {
      kind: "page-slug-shadows-collection-prefix";
      pageSlug: string;
      collectionSlug: string;
      detailUrlPrefix: string;
    };

/**
 * Verify the collection registry can route every public URL without
 * collisions. Returns an array of `RoutingConflict`s; an empty
 * result means the registry is well-formed.
 *
 * `pageSlugs` is the list of existing Pages-collection item slugs
 * (e.g. `["home", "about", "shows"]`). Used to catch the case where
 * an artist has a Page slugged `shows` while a tour-dates collection
 * declares `detailUrlPrefix: "/shows"` — the URL `/shows` would be
 * ambiguous (Page wins, tour-dates prefix becomes unreachable).
 */
export function validateCollectionRouting(
  defs: ReadonlyArray<CollectionDef>,
  pageSlugs: ReadonlyArray<string>,
): RoutingConflict[] {
  const conflicts: RoutingConflict[] = [];

  // 1. Two collections claiming the same `detailUrlPrefix`.
  const byPrefix = new Map<string, string[]>();
  for (const def of defs) {
    const prefix = def.detailUrlPrefix;
    if (prefix === null) continue;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(def.slug);
  }
  for (const [prefix, slugs] of byPrefix) {
    if (slugs.length > 1) {
      conflicts.push({
        kind: "duplicate-detail-url-prefix",
        detailUrlPrefix: prefix,
        collectionSlugs: slugs,
      });
    }
  }

  // 2. A Page slug collides with another collection's prefix root.
  // Compute the set of "first-segment claims": the segment a non-`/`
  // prefix occupies at the root. `/shows` claims `shows`; `/news/posts`
  // claims `news` (Pages would still be able to use `news/posts/...`,
  // but realistically the artist will never reach that URL).
  const claimedFirstSegments = new Map<string, { slug: string; prefix: string }>();
  for (const def of defs) {
    const prefix = def.detailUrlPrefix;
    if (prefix === null || prefix === "/") continue;
    const firstSegment = prefix.split("/")[1];
    if (firstSegment) {
      claimedFirstSegments.set(firstSegment, { slug: def.slug, prefix });
    }
  }
  for (const pageSlug of pageSlugs) {
    const claim = claimedFirstSegments.get(pageSlug);
    if (claim) {
      conflicts.push({
        kind: "page-slug-shadows-collection-prefix",
        pageSlug,
        collectionSlug: claim.slug,
        detailUrlPrefix: claim.prefix,
      });
    }
  }

  return conflicts;
}

/**
 * Throw if the registry has any routing conflict, with every conflict
 * described in the message. The public catch-all calls this from
 * `generateStaticParams`, so a conflict fails `next build` with a
 * structured error rather than turning every public page into a 500.
 */
export function assertCollectionRouting(
  defs: ReadonlyArray<CollectionDef>,
  pageSlugs: ReadonlyArray<string>,
): void {
  const conflicts = validateCollectionRouting(defs, pageSlugs);
  if (conflicts.length > 0) {
    throw new Error(
      `Collection-routing conflict:\n${conflicts.map(describeRoutingConflict).join("\n")}`,
    );
  }
}

/**
 * Every public URL to prerender, as catch-all segment arrays: `[]` for
 * the root (when a page owns it), then each item of every collection
 * with detail pages, Pages included.
 *
 * A URL is kept only when `resolveCollectionItemUrl` dispatches it back
 * to the same item, so the prerendered set can't drift from what the
 * renderer serves (e.g. a nested prefix shadowed by a longer one).
 */
export function listPublicRouteSegments(
  defs: ReadonlyArray<CollectionDef>,
  itemSlugsByCollection: ReadonlyMap<string, ReadonlyArray<string>>,
  hasRootPage: boolean,
): string[][] {
  const routes: string[][] = hasRootPage ? [[]] : [];
  const seen = new Set<string>();
  for (const def of defs) {
    for (const itemSlug of itemSlugsByCollection.get(def.slug) ?? []) {
      const url = itemDetailUrl(def, itemSlug);
      if (url === null || seen.has(url)) continue;
      const segments = url.split("/").filter(Boolean);
      const resolved = resolveCollectionItemUrl(segments, defs);
      if (resolved?.collectionSlug !== def.slug || resolved.itemSlug !== itemSlug) continue;
      seen.add(url);
      routes.push(segments);
    }
  }
  return routes;
}

/**
 * Single-slug shadowing check, used by page creation
 * (`POST /api/collections/pages/items`) to reject a proposed slug BEFORE
 * it lands on disk. Returns the offending collection's slug + prefix
 * if `pageSlug` would shadow a non-Pages collection's prefix root,
 * `null` otherwise.
 *
 * The full `validateCollectionRouting` runs at build time and
 * surfaces every conflict in the registry; this helper is the
 * pre-flight version for the single-slug case so the editor can fail
 * a creation attempt with a useful 409 instead of letting the new
 * page render the entire site unreachable.
 */
export function findShadowingPrefix(
  pageSlug: string,
  defs: ReadonlyArray<CollectionDef>,
): { collectionSlug: string; detailUrlPrefix: string } | null {
  for (const def of defs) {
    const prefix = def.detailUrlPrefix;
    if (prefix === null || prefix === "/") continue;
    const firstSegment = prefix.split("/")[1];
    if (firstSegment === pageSlug) {
      return { collectionSlug: def.slug, detailUrlPrefix: prefix };
    }
  }
  return null;
}

/**
 * Format a `RoutingConflict` for inclusion in an error message.
 * Surfaces enough context that the artist (or developer) can fix it
 * without grepping schemas.
 */
export function describeRoutingConflict(conflict: RoutingConflict): string {
  switch (conflict.kind) {
    case "duplicate-detail-url-prefix":
      return `Two collections claim the same detail URL prefix "${conflict.detailUrlPrefix}": ${conflict.collectionSlugs.join(", ")}. Change one of their detailUrlPrefix values so each is unique.`;
    case "page-slug-shadows-collection-prefix":
      return `The Page slugged "${conflict.pageSlug}" shadows the "${conflict.collectionSlug}" collection's detail URL prefix "${conflict.detailUrlPrefix}". Rename the page or change the prefix; otherwise the collection's detail URLs become unreachable.`;
    default: {
      const _exhaustive: never = conflict;
      void _exhaustive;
      return "Unknown routing conflict";
    }
  }
}
