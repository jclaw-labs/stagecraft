/**
 * Registry of custom admin surfaces.
 *
 * Every editable collection has a generic editor at
 * `/admin/collections/<slug>/items/<itemSlug>`. For collections where
 * we want a richer, hand-authored UX (drag-and-drop for Pages,
 * grouped FieldGroups for Site Settings, etc.) the platform ships a
 * dedicated panel at a stable URL. This file is the single source of
 * truth for which collections have one.
 *
 * Effects of registration:
 *
 *   1. **Sidebar.** `AdminShell` lists every entry here as a
 *      top-level item in a "Custom" group, before the generic
 *      `Collections` group. Order in this array is the sidebar
 *      order.
 *   2. **Direct-URL redirect.** A visit to
 *      `/admin/collections/<slug>/items/_singleton` (or
 *      `/admin/collections/<slug>` for non-singleton custom panels)
 *      redirects to the registered `route`. Mirrors how
 *      `/admin/pages` is canonical for the Pages collection — the
 *      generic URL bounces to the curated one.
 *   3. **`Collections` group filtering.** Collections registered
 *      here are hidden from the generic Collections list (otherwise
 *      Site Settings would appear twice in the sidebar).
 *
 * Adding a custom panel:
 *
 *   1. Add a route at `/admin/<name>` with the curated UI.
 *   2. Submit edits via `useSettingsForm({ collectionSlug, toValues })`
 *      so saves go through the same `/api/collections/<slug>/items/<itemSlug>`
 *      endpoint the generic editor uses. No second save API surface.
 *   3. Add an entry here.
 *
 * Singletons vs multi-item:
 *
 *   - Site / Header / Appearance are singleton collections — the
 *      registered `route` edits the one item directly.
 *   - Pages is non-singleton — the registered `route` is the list
 *      view with drag-reorder + nav-toggle UX; per-item editing
 *      lives at `/admin/pages/<slug>`.
 */

export type CustomAdminSurface = {
  /** The Collection this surface edits (matches `_collection.json` slug). */
  collectionSlug: string;
  /** Where the curated UI lives (singleton item, or multi-item list). */
  route: string;
  /** Sidebar label. */
  label: string;
  /** One-line summary used in any list view that surfaces it. */
  description: string;
  /**
   * Matches the legacy `AdminShell` activeSection so existing
   * pages keep working. Future panels can pick any stable string.
   */
  section: string;
  /**
   * For multi-item custom panels (Pages), where a per-item URL
   * inside `/admin/collections/<slug>/items/<itemSlug>` should
   * redirect to. Singleton panels leave this unset — the singleton
   * redirect uses `route` directly.
   */
  itemRoute?: (itemSlug: string) => string;
};

export const CUSTOM_ADMIN_SURFACES: ReadonlyArray<CustomAdminSurface> = [
  {
    collectionSlug: "pages",
    route: "/admin/pages",
    label: "Pages",
    description: "Add, remove, and edit the pages on your site.",
    section: "pages",
    itemRoute: (itemSlug) => `/admin/pages/${itemSlug}`,
  },
  {
    collectionSlug: "site",
    route: "/admin/settings",
    label: "Site Settings",
    description: "Artist name, social links, contact, copyright.",
    section: "settings",
  },
  {
    collectionSlug: "header",
    route: "/admin/navigation",
    label: "Header & Navigation",
    description:
      "Wordmark, header style, and which pages appear in the nav.",
    section: "navigation",
  },
  {
    collectionSlug: "appearance",
    route: "/admin/appearance",
    label: "Appearance",
    description: "Colors and typography.",
    section: "appearance",
  },
];

/**
 * Lookup helper — returns the registered surface for a given
 * collection slug, or null if the collection uses the generic
 * editor. Derived `Map` for O(1) lookup since the redirect runs on
 * every request to a per-item URL.
 */
const CUSTOM_SURFACES_BY_SLUG = new Map(
  CUSTOM_ADMIN_SURFACES.map((s) => [s.collectionSlug, s]),
);

export function findCustomSurface(
  collectionSlug: string,
): CustomAdminSurface | null {
  return CUSTOM_SURFACES_BY_SLUG.get(collectionSlug) ?? null;
}

/** Set of collection slugs that have a custom surface. */
export const CUSTOM_PANEL_COLLECTION_SLUGS: ReadonlySet<string> = new Set(
  CUSTOM_ADMIN_SURFACES.map((s) => s.collectionSlug),
);
