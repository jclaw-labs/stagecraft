/**
 * Pure helper for the drawer-search visibility computation. Lives
 * in its own file so it's testable without driving the Puck reducer.
 *
 * `DrawerCategoryVisibilitySync` (admin/pages/[slug]/Editor.tsx)
 * dispatches `setUi` with the result; the dispatch then flows
 * through Puck's reducer to update `state.ui.componentList`, which
 * is what Puck reads to decide which drawer-category headers to
 * render.
 *
 * The reducer is `(filter, categories, previous) → next`. The
 * `previous` argument carries the artist's per-category `expanded`
 * state — replacing the whole entry without spreading `previous`
 * would wipe `expanded` on every keystroke.
 */

/**
 * One drawer-category entry as Puck stores it on
 * `state.ui.componentList`. Mirrors the public Puck type without
 * pulling in the package (this helper runs server-side too).
 */
export type DrawerCategoryEntry = {
  components?: string[];
  title?: string;
  /** Artist's manual collapse state — must survive filter changes. */
  expanded?: boolean;
  visible?: boolean;
};

/**
 * Puck's componentList type uses a non-nullable value type
 * (`Record<string, Entry>`), so our output mirrors that. The
 * `previous` input may have undefined entries (a sparse object),
 * which we handle defensively at the lookup site.
 */
export type DrawerCategoryList = Record<string, DrawerCategoryEntry>;

export type CategoryConfig = {
  components?: string[];
  title?: string;
};

/**
 * Compute the next `componentList` given an active filter, the
 * registered Puck categories, and Puck's previous state. Pure
 * over its inputs — no side effects, deterministic, easy to test.
 *
 * Per-category rules:
 * - `visible` — true when the filter is empty, OR when at least one
 *   of the category's components matches the filter (case-
 *   insensitive substring).
 * - `expanded` — copied from `previous[key].expanded` so the
 *   artist's manual collapse state survives a filter change.
 * - `components` — re-emitted (cloned) from the registered
 *   category's component list so Puck always sees the current
 *   registry.
 * - `title` — copied from the registered category.
 */
export function computeCategoryVisibility(
  filter: string,
  categories: Record<string, CategoryConfig | undefined>,
  previous: DrawerCategoryList,
): DrawerCategoryList {
  const q = filter.trim().toLowerCase();
  const next: DrawerCategoryList = {};
  for (const [key, cat] of Object.entries(categories)) {
    const prev = previous[key];
    next[key] = {
      // Preserve everything the artist has touched (expanded
      // state, in particular), then overwrite the bits we own.
      ...prev,
      components: cat?.components ? [...cat.components] : undefined,
      title: cat?.title,
      visible:
        !q ||
        (cat?.components?.some((c) => c.toLowerCase().includes(q)) ?? true),
    };
  }
  return next;
}

/**
 * Decide whether `computeCategoryVisibility(filter, ...)` is a
 * provable no-op against Puck's default initialisation: every
 * category visible, no filter applied, no prior dispatch. The
 * call-site short-circuits on this — saves one dispatch on the
 * common "drawer mounts with empty filter" case.
 *
 * Returns true only when the filter is empty AND the caller can
 * vouch that no prior non-empty filter was applied. The caller's
 * ref-based "have we ever dispatched" check is the second
 * predicate.
 */
export function isVisibilityDispatchTrivial(filter: string): boolean {
  return filter.trim() === "";
}
