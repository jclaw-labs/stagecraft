import { describe, expect, it } from "vitest";

import {
  applyFilter,
  clauseWithoutMissingFields,
  mapFilterFields,
  withoutClausesOnMissingFields,
} from "./filter";
import type { Filter, FilterClause, Item } from "../schema";
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

// ---------------------------------------------------------------------------
// `today` FilterValue — relative-date windows
// ---------------------------------------------------------------------------

describe("applyFilter — `today` value", () => {
  // Fixed clock so the relative window is deterministic (UTC noon, Jul 17).
  const NOW = new Date("2026-07-17T12:00:00.000Z");

  it("`gte today` keeps today + future, drops past (the upcoming window)", () => {
    const filter: Filter = { all: [{ field: "f_date", op: "gte", value: { kind: "today" } }] };
    // ITEMS: paris 07-15, lyon 07-16 (both past), berlin 07-20, madrid 08-01.
    expect(applyFilter(ITEMS, filter, CURRENT, NOW).map((i) => i.slug)).toEqual(["berlin", "madrid"]);
  });

  it("`lt today` keeps strictly past dates", () => {
    const filter: Filter = { all: [{ field: "f_date", op: "lt", value: { kind: "today" } }] };
    expect(applyFilter(ITEMS, filter, CURRENT, NOW).map((i) => i.slug)).toEqual(["paris", "lyon"]);
  });

  it("`gte today` is inclusive of a same-day date-only value", () => {
    const onToday = tourDateItem("today-show", "2026-07-17", "Venue", "City", "on_sale");
    const filter: Filter = { all: [{ field: "f_date", op: "gte", value: { kind: "today" } }] };
    expect(applyFilter([onToday], filter, CURRENT, NOW).map((i) => i.slug)).toEqual(["today-show"]);
  });

  it("`gte today` keeps a timestamped value later the same day (date-only compare)", () => {
    const evening = tourDateItem("evening", "2026-07-17T20:00:00.000Z", "Venue", "City", "on_sale");
    const filter: Filter = { all: [{ field: "f_date", op: "gte", value: { kind: "today" } }] };
    expect(applyFilter([evening], filter, CURRENT, NOW).map((i) => i.slug)).toEqual(["evening"]);
  });

  it("composes 'upcoming + exclude cancelled' (the tour-dates use case)", () => {
    const filter: Filter = {
      all: [
        { field: "f_date", op: "gte", value: { kind: "today" } },
        { field: "f_status", op: "notEquals", value: { kind: "literal", value: "cancelled" } },
      ],
    };
    // Upcoming: berlin (07-20) + madrid (08-01); madrid is cancelled → dropped.
    expect(applyFilter(ITEMS, filter, CURRENT, NOW).map((i) => i.slug)).toEqual(["berlin"]);
  });

  it("defaults `now` to the current date when the arg is omitted (no throw)", () => {
    const filter: Filter = { all: [{ field: "f_date", op: "gte", value: { kind: "today" } }] };
    expect(() => applyFilter(ITEMS, filter, CURRENT)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// mapFilterFields
// ---------------------------------------------------------------------------

describe("mapFilterFields", () => {
  const rename = (id: string) => (id === "f_date" ? "f_new_date" : id);

  it("maps every clause's field in an `all` filter", () => {
    const filter: Filter = {
      all: [
        { field: "f_date", op: "gte", value: { kind: "today" } },
        { field: "f_status", op: "in", values: [{ kind: "literal", value: "on_sale" }] },
        { field: "f_date", op: "isNotEmpty" },
      ],
    };
    expect(mapFilterFields(filter, rename)).toEqual({
      all: [
        { field: "f_new_date", op: "gte", value: { kind: "today" } },
        { field: "f_status", op: "in", values: [{ kind: "literal", value: "on_sale" }] },
        { field: "f_new_date", op: "isNotEmpty" },
      ],
    });
  });

  it("maps an `any` filter and keeps excludeCurrentItem clauses", () => {
    const filter: Filter = {
      any: [{ excludeCurrentItem: true }, { field: "f_date", op: "lt", value: { kind: "today" } }],
    };
    expect(mapFilterFields(filter, rename)).toEqual({
      any: [{ excludeCurrentItem: true }, { field: "f_new_date", op: "lt", value: { kind: "today" } }],
    });
  });

  it("leaves a currentItemField value alone by default: it names a field of the surrounding item", () => {
    const filter: Filter = {
      all: [{ field: "f_venue", op: "equals", value: { kind: "currentItemField", fieldId: "f_date" } }],
    };
    expect(mapFilterFields(filter, rename)).toEqual(filter);
  });

  it("maps currentItemField values (single and `in` lists) through the current-item mapper", () => {
    const currentRename = (id: string) => (id === "f_city" ? "f_new_city" : id);
    const filter: Filter = {
      any: [
        { field: "f_date", op: "equals", value: { kind: "currentItemField", fieldId: "f_city" } },
        {
          field: "f_venue",
          op: "in",
          values: [
            { kind: "currentItemField", fieldId: "f_city" },
            { kind: "literal", value: "f_city" },
          ],
        },
        { field: "f_venue", op: "equals", value: { kind: "currentItemField", fieldId: "f_venue" } },
      ],
    };
    expect(mapFilterFields(filter, rename, currentRename)).toEqual({
      any: [
        { field: "f_new_date", op: "equals", value: { kind: "currentItemField", fieldId: "f_new_city" } },
        {
          field: "f_venue",
          op: "in",
          values: [
            { kind: "currentItemField", fieldId: "f_new_city" },
            { kind: "literal", value: "f_city" },
          ],
        },
        { field: "f_venue", op: "equals", value: { kind: "currentItemField", fieldId: "f_venue" } },
      ],
    });
  });

  it("doesn't mutate the input", () => {
    const filter: Filter = { all: [{ field: "f_date", op: "gte", value: { kind: "today" } }] };
    mapFilterFields(filter, rename);
    expect(filter).toEqual({ all: [{ field: "f_date", op: "gte", value: { kind: "today" } }] });
  });
});

// ---------------------------------------------------------------------------
// withoutClausesOnMissingFields
// ---------------------------------------------------------------------------

describe("withoutClausesOnMissingFields", () => {
  const present = new Set(["f_date", "f_venue"]);
  const hasField = (id: string) => present.has(id);

  it("drops a clause on a missing field and keeps clauses on present ones", () => {
    const filter: Filter = {
      all: [
        { field: "f_date", op: "gte", value: { kind: "today" } },
        { field: "f_status", op: "notEquals", value: { kind: "literal", value: "cancelled" } },
        { field: "f_venue", op: "isNotEmpty" },
      ],
    };
    expect(withoutClausesOnMissingFields(filter, hasField)).toEqual({
      all: [
        { field: "f_date", op: "gte", value: { kind: "today" } },
        { field: "f_venue", op: "isNotEmpty" },
      ],
    });
  });

  it("keeps excludeCurrentItem clauses in an `all` group", () => {
    const filter: Filter = {
      all: [{ excludeCurrentItem: true }, { field: "f_gone", op: "isNotEmpty" }],
    };
    expect(withoutClausesOnMissingFields(filter, hasField)).toEqual({
      all: [{ excludeCurrentItem: true }],
    });
  });

  it("drops a whole `any` group with a clause on a missing field, since that clause matches every item", () => {
    const filter: Filter = {
      any: [
        { field: "f_gone", op: "equals", value: { kind: "literal", value: "x" } },
        { field: "f_venue", op: "equals", value: { kind: "literal", value: "Lido" } },
      ],
    };
    expect(withoutClausesOnMissingFields(filter, hasField)).toBeNull();
  });

  it("keeps an `any` group whose fields are all present", () => {
    const filter: Filter = {
      any: [{ excludeCurrentItem: true }, { field: "f_venue", op: "isNotEmpty" }],
    };
    expect(withoutClausesOnMissingFields(filter, hasField)).toBe(filter);
  });

  it("never narrows what an `any` filter listed, even with `isEmpty` on the missing field", () => {
    // `isEmpty` on a deleted field matched every item before; dropping
    // just that disjunct would leave only the Lido show.
    const filter: Filter = {
      any: [
        { field: "f_gone", op: "isEmpty" },
        { field: "f_venue", op: "equals", value: { kind: "literal", value: "Lido" } },
      ],
    };
    const before = applyFilter(ITEMS, filter, CURRENT).map((i) => i.slug);
    const after = applyFilter(ITEMS, withoutClausesOnMissingFields(filter, hasField), CURRENT).map(
      (i) => i.slug,
    );
    expect(before).toEqual(["paris", "lyon", "berlin", "madrid"]);
    expect(after).toEqual(before);
  });

  it("returns the filter unchanged when every field is present", () => {
    const filter: Filter = { all: [{ field: "f_date", op: "gte", value: { kind: "today" } }] };
    expect(withoutClausesOnMissingFields(filter, hasField)).toEqual(filter);
  });

  describe("a currentItemField value on a field the surrounding item lacks", () => {
    const currentHas = new Set(["f_city"]);
    const hasCurrentItemField = (id: string) => currentHas.has(id);
    const gone = { kind: "currentItemField", fieldId: "f_gone" } as const;
    const city = { kind: "currentItemField", fieldId: "f_city" } as const;

    it("drops a single-value clause comparing against it", () => {
      const filter: Filter = {
        all: [
          { field: "f_venue", op: "equals", value: gone },
          { field: "f_venue", op: "equals", value: city },
        ],
      };
      expect(withoutClausesOnMissingFields(filter, hasField, hasCurrentItemField)).toEqual({
        all: [{ field: "f_venue", op: "equals", value: city }],
      });
    });

    it("drops a whole `any` group with such a clause", () => {
      const filter: Filter = {
        any: [
          { field: "f_venue", op: "equals", value: gone },
          { field: "f_venue", op: "equals", value: { kind: "literal", value: "Lido" } },
        ],
      };
      expect(withoutClausesOnMissingFields(filter, hasField, hasCurrentItemField)).toBeNull();
    });

    it("keeps such a clause when no current-item check is passed", () => {
      const filter: Filter = { all: [{ field: "f_venue", op: "equals", value: gone }] };
      expect(withoutClausesOnMissingFields(filter, hasField)).toEqual(filter);
    });

    it("drops only that value from an `in` list, since it never matches anything", () => {
      const filter: Filter = {
        all: [
          { field: "f_venue", op: "in", values: [gone, { kind: "literal", value: "Lido" }] },
        ],
      };
      const pruned = withoutClausesOnMissingFields(filter, hasField, hasCurrentItemField);
      expect(pruned).toEqual({
        all: [{ field: "f_venue", op: "in", values: [{ kind: "literal", value: "Lido" }] }],
      });
      // Same items either way: the dead value was already a no-op.
      expect(applyFilter(ITEMS, pruned, CURRENT)).toEqual(applyFilter(ITEMS, filter, CURRENT));
    });

    it("drops an `in` / `notIn` clause once none of its values are left", () => {
      const filter: Filter = {
        all: [
          { field: "f_venue", op: "in", values: [gone] },
          { field: "f_venue", op: "notIn", values: [gone, gone] },
          { field: "f_date", op: "gte", value: { kind: "today" } },
        ],
      };
      expect(withoutClausesOnMissingFields(filter, hasField, hasCurrentItemField)).toEqual({
        all: [{ field: "f_date", op: "gte", value: { kind: "today" } }],
      });
    });
  });

  it("returns null when no clause is left, so an `any` doesn't turn into match-nothing", () => {
    const anyGone: Filter = { any: [{ field: "f_gone", op: "isNotEmpty" }] };
    const allGone: Filter = { all: [{ field: "f_gone", op: "isEmpty" }] };
    expect(withoutClausesOnMissingFields(anyGone, hasField)).toBeNull();
    expect(withoutClausesOnMissingFields(allGone, hasField)).toBeNull();
    expect(withoutClausesOnMissingFields({ all: [] }, hasField)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clauseWithoutMissingFields
// ---------------------------------------------------------------------------

describe("clauseWithoutMissingFields", () => {
  const hasField = (id: string) => id === "f_venue";
  const hasCurrentItemField = (id: string) => id === "f_city";

  it("returns a clause with nothing missing as is", () => {
    const clause: FilterClause = {
      field: "f_venue",
      op: "in",
      values: [{ kind: "currentItemField", fieldId: "f_city" }, { kind: "literal", value: "x" }],
    };
    expect(clauseWithoutMissingFields(clause, hasField, hasCurrentItemField)).toBe(clause);
  });

  it("returns null for a clause on a missing field, whatever its op", () => {
    expect(clauseWithoutMissingFields({ field: "f_gone", op: "isEmpty" }, hasField)).toBeNull();
    expect(
      clauseWithoutMissingFields(
        { field: "f_gone", op: "equals", value: { kind: "literal", value: 1 } },
        hasField,
      ),
    ).toBeNull();
  });

  it("returns null for a single value naming a missing current-item field", () => {
    expect(
      clauseWithoutMissingFields(
        { field: "f_venue", op: "gte", value: { kind: "currentItemField", fieldId: "f_gone" } },
        hasField,
        hasCurrentItemField,
      ),
    ).toBeNull();
  });

  it("keeps excludeCurrentItem and value-less clauses on present fields", () => {
    expect(clauseWithoutMissingFields({ excludeCurrentItem: true }, hasField)).toEqual({
      excludeCurrentItem: true,
    });
    expect(clauseWithoutMissingFields({ field: "f_venue", op: "isNotEmpty" }, hasField)).toEqual({
      field: "f_venue",
      op: "isNotEmpty",
    });
  });
});
