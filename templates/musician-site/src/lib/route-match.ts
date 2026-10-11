/**
 * Path matching for the admin and API routers (ADR-016 §1). Each router
 * serves a whole URL space from one catch-all route file, so the
 * artist-repo shell never changes when a page or endpoint is added.
 *
 * A pattern is a `/`-separated path relative to the router's base, with
 * `:name` for a dynamic segment: `collections/:slug/items`. The empty
 * pattern is the base itself (`/admin`).
 */

/** The dynamic segments a match captured, keyed by name. */
export type RouteParams = Record<string, string>;

export type RouteMatch<T> = { route: T; params: RouteParams };

/** A pattern's segments; the empty pattern has none. */
export function patternSegments(pattern: string): string[] {
  return pattern.split("/").filter(Boolean);
}

/**
 * The params `segments` binds against `pattern`, or null when they
 * don't match. Matching is exact: no trailing segments are allowed.
 */
export function matchPattern(pattern: string, segments: readonly string[]): RouteParams | null {
  const parts = patternSegments(pattern);
  if (parts.length !== segments.length) return null;
  const params: RouteParams = {};
  for (const [i, part] of parts.entries()) {
    if (part.startsWith(":")) params[part.slice(1)] = segments[i];
    else if (part !== segments[i]) return null;
  }
  return params;
}

/**
 * Whether `a` is more specific than `b`: at the first segment where one
 * is literal and the other dynamic, the literal wins. That's how Next.js
 * ranks `collections/new` over `collections/[slug]`.
 */
function moreSpecific(a: string, b: string): boolean {
  const as = patternSegments(a);
  const bs = patternSegments(b);
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const aDynamic = as[i].startsWith(":");
    const bDynamic = bs[i].startsWith(":");
    if (aDynamic !== bDynamic) return bDynamic;
  }
  return false;
}

/** The most specific route whose pattern matches `segments`, or null. */
export function matchRoute<T extends { pattern: string }>(
  routes: readonly T[],
  segments: readonly string[],
): RouteMatch<T> | null {
  let best: RouteMatch<T> | null = null;
  for (const route of routes) {
    const params = matchPattern(route.pattern, segments);
    if (params && (!best || moreSpecific(route.pattern, best.route.pattern))) best = { route, params };
  }
  return best;
}
