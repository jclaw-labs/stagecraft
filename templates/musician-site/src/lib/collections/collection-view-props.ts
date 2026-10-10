/**
 * Generic Collection-block props (ADR-015) for a page-embedded collection
 * view, shared by two callers so a freshly dragged-in block behaves exactly
 * like the seeded one:
 *
 *   - the welcome / page seeds (`first-run-seeds.ts`), which spread in an
 *     explicit block `id`; and
 *   - the page editor's block `defaultProps` (`collection-view-editor.tsx`),
 *     where Puck assigns the id.
 *
 * Client-safe: imports only the node-free field-id constants (never via
 * `seeds.ts`, which would drag `schema.ts → node:crypto` into the bundle —
 * see CLAUDE.md "Client-bundle discipline") and returns plain data. No `id`;
 * callers that need one spread it in.
 */

import { POSTS_FIELD_IDS, RELEASES_FIELD_IDS, TOUR_DATES_FIELD_IDS } from "./field-ids";

/** Default "max items" for the prebaked demo collections; others default to 6. */
const DEFAULT_VIEW_LIMITS: Readonly<Record<string, number>> = {
  "tour-dates": 5,
  releases: 8,
  posts: 6,
};

export function defaultCollectionViewLimit(slug: string): number {
  return DEFAULT_VIEW_LIMITS[slug] ?? 6;
}

/**
 * The source + sort + filter that reproduce each demo section:
 *   - `tour-dates` → upcoming (date ≥ today) + not-cancelled, soonest-first;
 *   - `releases` / `posts` → newest-first.
 *
 * The sort and filter name the seed field ids. When the artist deletes one
 * of those fields that isn't system-locked (releases `releaseDate`) and
 * adds a same-name field back, the Collection block resolves the saved id
 * to the new field at render time (`viewFieldIdFor` in
 * `template/view-requirements.ts`), so the saved props never need
 * rewriting. Tour-date `status` opts out of that match (see its
 * `matchesByKey`). A clause whose field is gone with nothing in its place
 * is dropped, so deleting `status` lists cancelled shows too rather than
 * hiding every show.
 *
 * Any other collection gets just `{ sourceCollection, limit }` — no opinionated
 * ordering, since its own `itemTemplate` (or the default card) decides
 * presentation.
 */
export function collectionViewProps(
  sourceCollection: string,
  limit: number,
): Record<string, unknown> {
  if (sourceCollection === "tour-dates") {
    return {
      sourceCollection,
      limit,
      sort: { fieldId: TOUR_DATES_FIELD_IDS.date, direction: "asc" },
      filter: {
        all: [
          { field: TOUR_DATES_FIELD_IDS.date, op: "gte", value: { kind: "today" } },
          {
            field: TOUR_DATES_FIELD_IDS.status,
            op: "notEquals",
            value: { kind: "literal", value: "cancelled" },
          },
        ],
      },
    };
  }
  if (sourceCollection === "releases") {
    return {
      sourceCollection,
      limit,
      sort: { fieldId: RELEASES_FIELD_IDS.releaseDate, direction: "desc" },
    };
  }
  if (sourceCollection === "posts") {
    return {
      sourceCollection,
      limit,
      sort: { fieldId: POSTS_FIELD_IDS.publishedAt, direction: "desc" },
    };
  }
  return { sourceCollection, limit };
}
