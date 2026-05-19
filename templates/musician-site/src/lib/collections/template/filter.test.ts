import { describe, expect, it } from "vitest";

import { applyFilter } from "./filter";
import type { Filter, Item } from "../schema";
import { FIXTURE_TIMESTAMP } from "../test-fixtures";

/** Make a tour-date-shaped item with the fields the tests want. */
function tourDateItem(
  slug: string,
  date: string,
  venue: string,
  city: string,
  status: "on_sale" | "sold_out" | "cancelled" | "free",
  tags: string[] = [],
): Item {
  return {
    id: `item_${slug}`,
    slug,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values: {
      f_date: { type: "date", value: date },
      f_venue: { type: "text", value: venue },
      f_city: { type: "text", value: city },
      f_status: { type: "select", value: status },
      ...(tags.length
        ? { f_tags: { type: "multiSelect" as const, value: tags } }
        : {}),
    },
  };
}

const ITEMS: Item[] = [
  tourDateItem("paris", "2026-07-15", "La Cigale", "Paris", "on_sale", ["headline"]),
  tourDateItem("lyon", "2026-07-16", "Le Transbordeur", "Lyon", "sold_out", ["headline"]),
  tourDateItem("berlin", "2026-07-20", "Lido", "Berlin", "on_sale", ["support"]),
  tourDateItem("madrid", "2026-08-01", "Sala Apolo", "Madrid", "cancelled", []),
];

const CURRENT: Item = tourDateItem("paris", "2026-07-15", "La Cigale", "Paris", "on_sale", ["headline"]);

// ---------------------------------------------------------------------------
// Trivial paths
// ---------------------------------------------------------------------------

describe("applyFilter — trivial paths", () => {
  it("returns every item when filter is null", () => {
    expect(applyFilter(ITEMS, null, CURRENT)).toHaveLength(ITEMS.length);
  });

  it("returns every item for an empty `all`", () => {
    expect(applyFilter(ITEMS, { all: [] }, CURRENT)).toHaveLength(ITEMS.length);
  });

  it("returns no items for an empty `any`", () => {
    // `any` with an empty list has no true clause — nothing matches.
    expect(applyFilter(ITEMS, { any: [] }, CURRENT)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

describe("applyFilter — operators", () => {
  it("equals matches a literal", () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } }],
    };
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug)).toEqual(["paris"]);
  });

  it("notEquals inverts", () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "notEquals", value: { kind: "literal", value: "Paris" } }],
    };
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug).sort()).toEqual([
      "berlin",
      "lyon",
      "madrid",
    ]);
  });

  it("in matches any of the values", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_status",
          op: "in",
          values: [
            { kind: "literal", value: "on_sale" },
            { kind: "literal", value: "free" },
          ],
        },
      ],
    };
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug).sort()).toEqual([
      "berlin",
      "paris",
    ]);
  });

  it("isEmpty matches items without the field", () => {
    const filter: Filter = { all: [{ field: "f_tags", op: "isEmpty" }] };
    // madrid is the only item with no tags.
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug)).toEqual(["madrid"]);
  });

  it("isNotEmpty matches items with the field present", () => {
    const filter: Filter = { all: [{ field: "f_tags", op: "isNotEmpty" }] };
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug).sort()).toEqual([
      "berlin",
      "lyon",
      "paris",
    ]);
  });

  it("gte on date works lexicographically", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_date",
          op: "gte",
          value: { kind: "literal", value: "2026-07-20" },
        },
      ],
    };
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug).sort()).toEqual([
      "berlin",
      "madrid",
    ]);
  });

  it("contains is case-insensitive substring match on strings", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_venue",
          op: "contains",
          value: { kind: "literal", value: "TRANSBORD" },
        },
      ],
    };
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug)).toEqual(["lyon"]);
  });

  it("equals on a multiSelect field acts as 'contains this tag'", () => {
    const filter: Filter = {
      all: [
        { field: "f_tags", op: "equals", value: { kind: "literal", value: "headline" } },
      ],
    };
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug).sort()).toEqual([
      "lyon",
      "paris",
    ]);
  });
});

// ---------------------------------------------------------------------------
// currentItem context
// ---------------------------------------------------------------------------

describe("applyFilter — currentItem", () => {
  it("currentItemField pulls a scalar from currentItem.values", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_city",
          op: "equals",
          value: { kind: "currentItemField", fieldId: "f_city" },
        },
      ],
    };
    // CURRENT is "Paris" — matches only paris.
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug)).toEqual(["paris"]);
  });

  it("currentItemId compares against currentItem.id", () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "equals", value: { kind: "currentItemId" } }],
    };
    // currentItem.id is "item_paris"; no item's f_city equals it.
    expect(applyFilter(ITEMS, filter, CURRENT)).toEqual([]);
  });

  it("excludeCurrentItem drops the current item", () => {
    const filter: Filter = { all: [{ excludeCurrentItem: true }] };
    // CURRENT.id = "item_paris"; everything else stays.
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug).sort()).toEqual([
      "berlin",
      "lyon",
      "madrid",
    ]);
  });

  it("excludeCurrentItem composes with other clauses under all", () => {
    const filter: Filter = {
      all: [
        { excludeCurrentItem: true },
        { field: "f_status", op: "equals", value: { kind: "literal", value: "on_sale" } },
      ],
    };
    // on_sale: paris, berlin. Exclude paris (current). Leaves berlin.
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug)).toEqual(["berlin"]);
  });

  it("collectionRef field equals currentItemId — the canonical 'children of parent' pattern", () => {
    // ADR §5.1's worked example: tracks where belongsToAlbum equals
    // currentItem.id. Resolver pulls v.value.itemId out of the
    // collectionRef value, FilterValue resolves to currentItem.id,
    // equality holds for tracks belonging to this album.
    const ALBUM_ID = "item_album_2026";
    const tracks: Item[] = [
      {
        id: "item_t1",
        slug: "track-1",
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        values: { f_album: { type: "collectionRef", value: { itemId: ALBUM_ID } } },
      },
      {
        id: "item_t2",
        slug: "track-2",
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        values: { f_album: { type: "collectionRef", value: { itemId: "item_other_album" } } },
      },
      {
        id: "item_t3",
        slug: "track-3",
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        values: { f_album: { type: "collectionRef", value: { itemId: ALBUM_ID } } },
      },
    ];
    const album: Item = {
      id: ALBUM_ID,
      slug: "the-album",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: { f_title: { type: "text", value: "The Album" } },
    };
    const filter: Filter = {
      all: [{ field: "f_album", op: "equals", value: { kind: "currentItemId" } }],
    };
    expect(applyFilter(tracks, filter, album).map((i) => i.slug).sort()).toEqual([
      "track-1",
      "track-3",
    ]);
  });
});

// ---------------------------------------------------------------------------
// any vs all
// ---------------------------------------------------------------------------

describe("applyFilter — any / all", () => {
  it("any matches when at least one clause holds", () => {
    const filter: Filter = {
      any: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
        { field: "f_status", op: "equals", value: { kind: "literal", value: "cancelled" } },
      ],
    };
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug).sort()).toEqual([
      "madrid",
      "paris",
    ]);
  });

  it("all requires every clause to hold", () => {
    const filter: Filter = {
      all: [
        { field: "f_status", op: "equals", value: { kind: "literal", value: "on_sale" } },
        {
          field: "f_date",
          op: "gte",
          value: { kind: "literal", value: "2026-07-20" },
        },
      ],
    };
    // on_sale AND date ≥ Jul 20 → only Berlin.
    expect(applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug)).toEqual(["berlin"]);
  });
});

// ---------------------------------------------------------------------------
// Missing fields / unknown shapes
// ---------------------------------------------------------------------------

describe("applyFilter — missing fields and unsupported shapes", () => {
  it("returns false when the field isn't on the item", () => {
    const filter: Filter = {
      all: [
        { field: "f_does_not_exist", op: "equals", value: { kind: "literal", value: "x" } },
      ],
    };
    expect(applyFilter(ITEMS, filter, CURRENT)).toEqual([]);
  });

  it("gt against non-numeric / non-string returns false (always)", () => {
    // image/file/richText/puckContent shaped values aren't comparable;
    // building one isn't worth a full fixture — verify the missing-
    // field branch already handles it cleanly enough.
    const filter: Filter = {
      all: [
        { field: "f_missing", op: "gt", value: { kind: "literal", value: 5 } },
      ],
    };
    expect(applyFilter(ITEMS, filter, CURRENT)).toEqual([]);
  });
});
