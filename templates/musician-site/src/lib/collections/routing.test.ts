import { describe, expect, it } from "vitest";

import {
  describeRoutingConflict,
  findShadowingPrefix,
  resolveCollectionItemUrl,
  validateCollectionRouting,
} from "./routing";
import type { CollectionDef } from "./schema";

function def(
  slug: string,
  detailUrlPrefix: string | null,
  opts: { isSingleton?: boolean } = {},
): CollectionDef {
  return {
    schemaVersion: 1,
    slug,
    singularName: slug,
    pluralName: slug,
    fields: [],
    slugSourceFieldId: null,
    detailUrlPrefix,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: opts.isSingleton ?? false,
  };
}

// ---------------------------------------------------------------------------
// resolveCollectionItemUrl
// ---------------------------------------------------------------------------

describe("resolveCollectionItemUrl", () => {
  const PAGES = def("pages", "/");
  const TOUR = def("tour-dates", "/shows");
  const SITE = def("site", null, { isSingleton: true });

  it("returns null for the root URL", () => {
    expect(resolveCollectionItemUrl([], [PAGES, TOUR])).toBeNull();
  });

  it("routes /about to Pages", () => {
    expect(resolveCollectionItemUrl(["about"], [PAGES, TOUR])).toEqual({
      collectionSlug: "pages",
      itemSlug: "about",
    });
  });

  it("routes /shows/paris-2026 to tour-dates", () => {
    expect(resolveCollectionItemUrl(["shows", "paris-2026"], [PAGES, TOUR])).toEqual({
      collectionSlug: "tour-dates",
      itemSlug: "paris-2026",
    });
  });

  it("returns null for /shows (the list URL — caller handles list rendering)", () => {
    expect(resolveCollectionItemUrl(["shows"], [PAGES, TOUR])).toBeNull();
  });

  it("ignores singleton collections (no detail URL)", () => {
    // A singleton can't route detail URLs even if it had a prefix.
    expect(resolveCollectionItemUrl(["foo"], [SITE])).toBeNull();
  });

  it("rejects multi-segment Pages URLs (Pages slugs don't carry slashes)", () => {
    // /shows/paris would route to tour-dates above, but with ONLY
    // Pages registered, /shows/paris has no valid Pages slug.
    expect(resolveCollectionItemUrl(["shows", "paris"], [PAGES])).toBeNull();
  });

  it("longest-prefix wins when multiple prefixes overlap", () => {
    // A hypothetical collection at `/shows/archive` would win over
    // `/shows` for URLs starting with `/shows/archive/...`.
    const ARCHIVE = def("archive", "/shows/archive");
    const result = resolveCollectionItemUrl(
      ["shows", "archive", "old-paris"],
      [TOUR, ARCHIVE],
    );
    expect(result).toEqual({
      collectionSlug: "archive",
      itemSlug: "old-paris",
    });
  });

  it("falls through to no-match when no prefix fits", () => {
    // No Pages registered; /about has nowhere to land.
    expect(resolveCollectionItemUrl(["about"], [TOUR])).toBeNull();
  });

  it("skips collections with null detailUrlPrefix", () => {
    const QUOTES = def("quotes", null); // no detail URL
    expect(resolveCollectionItemUrl(["quotes", "x"], [QUOTES])).toBeNull();
  });

  it("rejects nested slugs under a prefix (no further nesting in v1)", () => {
    // /shows/2024/paris → would split slug as "2024/paris", which
    // includes a slash. Reject (v1 itemSlugs are single segments).
    expect(
      resolveCollectionItemUrl(["shows", "2024", "paris"], [TOUR]),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateCollectionRouting
// ---------------------------------------------------------------------------

describe("validateCollectionRouting", () => {
  it("returns no conflicts for a clean registry", () => {
    const defs = [def("pages", "/"), def("tour-dates", "/shows")];
    expect(validateCollectionRouting(defs, ["home", "about"])).toEqual([]);
  });

  it("flags two collections claiming the same detailUrlPrefix", () => {
    const defs = [def("pages", "/"), def("snippets", "/")];
    const conflicts = validateCollectionRouting(defs, []);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "duplicate-detail-url-prefix",
      detailUrlPrefix: "/",
      collectionSlugs: ["pages", "snippets"],
    });
  });

  it("flags a Page slug that shadows another collection's prefix root", () => {
    const defs = [def("pages", "/"), def("tour-dates", "/shows")];
    const conflicts = validateCollectionRouting(defs, ["home", "shows"]);
    expect(conflicts).toContainEqual({
      kind: "page-slug-shadows-collection-prefix",
      pageSlug: "shows",
      collectionSlug: "tour-dates",
      detailUrlPrefix: "/shows",
    });
  });

  it("doesn't flag unrelated page slugs", () => {
    const defs = [def("pages", "/"), def("tour-dates", "/shows")];
    expect(validateCollectionRouting(defs, ["home", "about", "contact"])).toEqual([]);
  });

  it("ignores collections with null detailUrlPrefix", () => {
    const defs = [def("pages", "/"), def("quotes", null)];
    expect(validateCollectionRouting(defs, ["quotes"])).toEqual([]);
  });

  it("renders human-readable messages", () => {
    expect(
      describeRoutingConflict({
        kind: "duplicate-detail-url-prefix",
        detailUrlPrefix: "/",
        collectionSlugs: ["pages", "snippets"],
      }),
    ).toContain("Two collections");
    expect(
      describeRoutingConflict({
        kind: "page-slug-shadows-collection-prefix",
        pageSlug: "shows",
        collectionSlug: "tour-dates",
        detailUrlPrefix: "/shows",
      }),
    ).toContain("shadows");
  });
});

// ---------------------------------------------------------------------------
// findShadowingPrefix (pre-flight helper for POST /api/pages)
// ---------------------------------------------------------------------------

describe("findShadowingPrefix", () => {
  const TOUR = def("tour-dates", "/shows");
  const POSTS = def("posts", "/news");
  const PAGES = def("pages", "/");
  const QUOTES = def("quotes", null);

  it("returns the offending collection when the slug shadows a prefix root", () => {
    expect(findShadowingPrefix("shows", [PAGES, TOUR, POSTS])).toEqual({
      collectionSlug: "tour-dates",
      detailUrlPrefix: "/shows",
    });
    expect(findShadowingPrefix("news", [PAGES, TOUR, POSTS])).toEqual({
      collectionSlug: "posts",
      detailUrlPrefix: "/news",
    });
  });

  it("returns null for slugs that don't shadow any prefix", () => {
    expect(findShadowingPrefix("about", [PAGES, TOUR, POSTS])).toBeNull();
    expect(findShadowingPrefix("home", [PAGES, TOUR, POSTS])).toBeNull();
  });

  it("ignores the Pages root prefix (`/`) — every page slug 'shadows' it by definition", () => {
    expect(findShadowingPrefix("about", [PAGES])).toBeNull();
  });

  it("ignores collections with null detailUrlPrefix", () => {
    expect(findShadowingPrefix("quotes", [PAGES, QUOTES])).toBeNull();
  });
});
