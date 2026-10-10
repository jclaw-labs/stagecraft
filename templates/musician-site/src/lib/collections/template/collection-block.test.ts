import { describe, expect, it } from "vitest";

import {
  blockNameForCollection,
  findCollectionBlockSources,
  resolveCollectionBlockProps,
  type CollectionBlockRawProps,
} from "./collection-block";
import type { Template } from "./types";
import { collectionViewProps } from "../collection-view-props";
import { RELEASES_FIELD_IDS, TOUR_DATES_FIELD_IDS } from "../field-ids";
import type { CollectionDef, FieldDef, Item } from "../schema";
import { releasesCollectionDef, tourDatesCollectionDef } from "../seeds";
import { FIXTURE_TIMESTAMP } from "../test-fixtures";

function dateItem(slug: string, date: string, venue: string): Item {
  return {
    id: `item_${slug}`,
    slug,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values: {
      f_date: { type: "date", value: date },
      f_venue: { type: "text", value: venue },
    },
  };
}

const TOUR_DATES_DEF: CollectionDef = {
  schemaVersion: 1,
  slug: "tour-dates",
  singularName: "tour date",
  pluralName: "tour dates",
  fields: [
    { id: "f_date", key: "date", type: "date", required: true },
    { id: "f_venue", key: "venue", type: "text", required: true },
  ],
  slugSourceFieldId: "f_venue",
  detailUrlPrefix: "/shows",
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

const PAGE_CURRENT: Item = {
  id: "item_some_page",
  slug: "home",
  createdAt: FIXTURE_TIMESTAMP,
  updatedAt: FIXTURE_TIMESTAMP,
  values: {},
};

function ctxWithItems(items: Item[]) {
  return {
    item: PAGE_CURRENT,
    currentItem: PAGE_CURRENT,
    loadedCollections: { "tour-dates": { def: TOUR_DATES_DEF, items } },
    recurse: <T>(b: T) => b,
  };
}

describe("blockNameForCollection", () => {
  it("converts kebab-case slugs to PascalCase + View", () => {
    expect(blockNameForCollection("tour-dates")).toBe("TourDatesView");
    expect(blockNameForCollection("pages")).toBe("PagesView");
    expect(blockNameForCollection("store-items")).toBe("StoreItemsView");
  });

  it("handles single-word slugs", () => {
    expect(blockNameForCollection("releases")).toBe("ReleasesView");
  });

  it("ignores empty segments from leading/trailing hyphens", () => {
    expect(blockNameForCollection("-foo-")).toBe("FooView");
  });
});

describe("resolveCollectionBlockProps", () => {
  const ITEMS = [
    dateItem("paris", "2026-07-15", "La Cigale"),
    dateItem("lyon", "2026-07-16", "Le Transbordeur"),
    dateItem("berlin", "2026-07-20", "Lido"),
  ];

  it("returns all items when no filter / sort / limit is set", () => {
    const raw: CollectionBlockRawProps = { sourceCollection: "tour-dates" };
    const out = resolveCollectionBlockProps(raw, ctxWithItems(ITEMS));
    expect(out.items.map((i) => i.slug)).toEqual(["paris", "lyon", "berlin"]);
    expect(out.sourceDef).toEqual(TOUR_DATES_DEF);
  });

  it("applies the filter against currentItem", () => {
    const raw: CollectionBlockRawProps = {
      sourceCollection: "tour-dates",
      filter: {
        all: [
          {
            field: "f_venue",
            op: "equals",
            value: { kind: "literal", value: "La Cigale" },
          },
        ],
      },
    };
    const out = resolveCollectionBlockProps(raw, ctxWithItems(ITEMS));
    expect(out.items.map((i) => i.slug)).toEqual(["paris"]);
  });

  it("sorts by field descending", () => {
    const raw: CollectionBlockRawProps = {
      sourceCollection: "tour-dates",
      sort: { fieldId: "f_date", direction: "desc" },
    };
    const out = resolveCollectionBlockProps(raw, ctxWithItems(ITEMS));
    expect(out.items.map((i) => i.slug)).toEqual(["berlin", "lyon", "paris"]);
  });

  it("limits to the first N after filter + sort", () => {
    const raw: CollectionBlockRawProps = {
      sourceCollection: "tour-dates",
      sort: { fieldId: "f_date", direction: "asc" },
      limit: 2,
    };
    const out = resolveCollectionBlockProps(raw, ctxWithItems(ITEMS));
    expect(out.items.map((i) => i.slug)).toEqual(["paris", "lyon"]);
  });

  it("returns empty + null def when the source collection wasn't pre-loaded", () => {
    const raw: CollectionBlockRawProps = { sourceCollection: "missing-collection" };
    const out = resolveCollectionBlockProps(raw, ctxWithItems([]));
    expect(out.items).toEqual([]);
    expect(out.sourceDef).toBeNull();
  });

  it("threads currentItem through into the resolved props", () => {
    const raw: CollectionBlockRawProps = { sourceCollection: "tour-dates" };
    const out = resolveCollectionBlockProps(raw, ctxWithItems(ITEMS));
    expect(out.currentItem).toBe(PAGE_CURRENT);
  });

  it("drops a clause on a field the collection no longer has and keeps the rest", () => {
    const raw: CollectionBlockRawProps = {
      sourceCollection: "tour-dates",
      filter: {
        all: [
          { field: "f_deleted", op: "equals", value: { kind: "literal", value: "x" } },
          { field: "f_venue", op: "notEquals", value: { kind: "literal", value: "Lido" } },
        ],
      },
    };
    const out = resolveCollectionBlockProps(raw, ctxWithItems(ITEMS));
    // The deleted-field clause would have hidden everything; the venue
    // clause still filters.
    expect(out.items.map((i) => i.slug)).toEqual(["paris", "lyon"]);
  });

  it("drops every clause of an `any` filter on deleted fields: no filter, not no items", () => {
    const raw: CollectionBlockRawProps = {
      sourceCollection: "tour-dates",
      filter: { any: [{ field: "f_deleted", op: "isNotEmpty" }] },
    };
    const out = resolveCollectionBlockProps(raw, ctxWithItems(ITEMS));
    expect(out.items).toHaveLength(ITEMS.length);
  });

  it("ignores limit when null / zero (renders all)", () => {
    for (const limit of [null, undefined, 0]) {
      const raw: CollectionBlockRawProps = {
        sourceCollection: "tour-dates",
        limit: limit as number | null | undefined,
      };
      const out = resolveCollectionBlockProps(raw, ctxWithItems(ITEMS));
      expect(out.items).toHaveLength(ITEMS.length);
    }
  });
});

// ---------------------------------------------------------------------------
// The default blocks' saved sort / filter after a delete + re-add (#436)
// ---------------------------------------------------------------------------

describe("resolveCollectionBlockProps — declared ids saved by the default blocks", () => {
  /** `def` with `fieldId` deleted and a same-type field named `key` added under a new id. */
  function reAdded(def: CollectionDef, fieldId: string, key: string, newId: string): CollectionDef {
    const old = def.fields.find((f) => f.id === fieldId)!;
    return {
      ...def,
      fields: [...def.fields.filter((f) => f.id !== fieldId), { ...old, id: newId, key } as FieldDef],
    };
  }

  function item(slug: string, values: Item["values"]): Item {
    return { id: `item_${slug}`, slug, createdAt: FIXTURE_TIMESTAMP, updatedAt: FIXTURE_TIMESTAMP, values };
  }

  function resolve(def: CollectionDef, items: Item[]) {
    const raw = collectionViewProps(def.slug, 10) as unknown as CollectionBlockRawProps;
    return resolveCollectionBlockProps(raw, {
      item: PAGE_CURRENT,
      currentItem: PAGE_CURRENT,
      loadedCollections: { [def.slug]: { def, items } },
    }).items.map((i) => i.slug);
  }

  const onSale = { [TOUR_DATES_FIELD_IDS.status]: { type: "select", value: "on_sale" } } as const;

  it("sorts and filters tour dates by a re-added `Date` field", () => {
    // `date` is system-locked, so the admin can't delete it; this covers
    // content edited outside the admin. Releases below is the case an
    // artist can reach.
    const def = reAdded(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.date, "Date", "fld_new_date");
    const shows = [
      item("later", { ...onSale, fld_new_date: { type: "date", value: "2099-08-01" } }),
      item("past", { ...onSale, fld_new_date: { type: "date", value: "2000-01-01" } }),
      item("sooner", { ...onSale, fld_new_date: { type: "date", value: "2099-07-01" } }),
    ];
    // Upcoming only, soonest first, exactly as with the seed's own field.
    expect(resolve(def, shows)).toEqual(["sooner", "later"]);
  });

  it("stops filtering by date once the date field is gone with nothing in its place", () => {
    // The clause names a deleted id, so it's dropped rather than hiding
    // every show for good.
    const def: CollectionDef = {
      ...tourDatesCollectionDef,
      fields: tourDatesCollectionDef.fields.filter((f) => f.id !== TOUR_DATES_FIELD_IDS.date),
    };
    const show = item("s", { ...onSale, fld_other: { type: "date", value: "2000-01-01" } });
    expect(resolve(def, [show])).toEqual(["s"]);
  });

  it("shows every upcoming show, cancelled ones included, once status is deleted", () => {
    const def: CollectionDef = {
      ...tourDatesCollectionDef,
      fields: tourDatesCollectionDef.fields.filter((f) => f.id !== TOUR_DATES_FIELD_IDS.status),
    };
    const date = (value: string) => ({ [TOUR_DATES_FIELD_IDS.date]: { type: "date", value } }) as const;
    const shows = [
      item("later", { ...date("2099-08-01") }),
      item("past", { ...date("2000-01-01") }),
      // A leftover value under the deleted id is ignored with the clause.
      item("cancelled", {
        ...date("2099-07-15"),
        [TOUR_DATES_FIELD_IDS.status]: { type: "select", value: "cancelled" },
      }),
      item("sooner", { ...date("2099-07-01") }),
    ];
    // The date clause and sort still apply: upcoming only, soonest first.
    expect(resolve(def, shows)).toEqual(["sooner", "cancelled", "later"]);
  });

  it("doesn't hand the status filter to a re-added status field: a fresh one has no values", () => {
    // Status opts out of name matching (`matchesByKey: false`): taking
    // over the new field would hide every show without a status while
    // the schema editor reported all clear. The clause stays on the
    // deleted id, so it's dropped and the new field's values are ignored.
    const def = reAdded(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.status, "status", "fld_new_status");
    const show = item("s", {
      [TOUR_DATES_FIELD_IDS.date]: { type: "date", value: "2099-08-01" },
      fld_new_status: { type: "select", value: "cancelled" },
    });
    expect(resolve(def, [show])).toEqual(["s"]);
  });

  it("sorts releases newest first by a re-added `release date` field", () => {
    const def = reAdded(
      releasesCollectionDef,
      RELEASES_FIELD_IDS.releaseDate,
      "release date",
      "fld_new_release_date",
    );
    const releases = [
      item("old", { fld_new_release_date: { type: "date", value: "2019-01-01" } }),
      item("new", { fld_new_release_date: { type: "date", value: "2025-01-01" } }),
      item("mid", { fld_new_release_date: { type: "date", value: "2022-01-01" } }),
    ];
    expect(resolve(def, releases)).toEqual(["new", "mid", "old"]);
  });

  describe("a currentItemField value on a tour-dates detail template", () => {
    // "Other shows in this city": a tour-dates Collection block on the
    // tour-dates detail template, saved with the seed's city id on both
    // sides of the clause.
    const raw: CollectionBlockRawProps = {
      sourceCollection: "tour-dates",
      filter: {
        all: [
          {
            field: TOUR_DATES_FIELD_IDS.city,
            op: "equals",
            value: { kind: "currentItemField", fieldId: TOUR_DATES_FIELD_IDS.city },
          },
          { excludeCurrentItem: true },
        ],
      },
    };
    const def = reAdded(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.city, "city", "fld_new_city");
    const city = (value: string) => ({ fld_new_city: { type: "text", value } }) as const;
    const current = item("here", city("Paris"));
    const shows = [current, item("same", city("Paris")), item("other", city("Lyon"))];

    function resolveOn(currentItemDef: CollectionDef | undefined) {
      return resolveCollectionBlockProps(raw, {
        item: current,
        currentItem: current,
        itemDef: def,
        currentItemDef,
        loadedCollections: { [def.slug]: { def, items: shows } },
      }).items.map((i) => i.slug);
    }

    it("reads the re-added field off the surrounding item", () => {
      expect(resolveOn(def)).toEqual(["same"]);
    });

    it("reads the saved id when the surrounding item's def isn't known", () => {
      // The saved id is gone from the current item, so nothing compares equal.
      expect(resolveOn(undefined)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// findCollectionBlockSources
// ---------------------------------------------------------------------------

describe("findCollectionBlockSources", () => {
  function template(content: unknown[]): Template {
    return { content, root: { props: {} } } as Template;
  }

  it("returns [] for null / empty templates", () => {
    expect(findCollectionBlockSources(null)).toEqual([]);
    expect(findCollectionBlockSources(template([]))).toEqual([]);
  });

  it("picks up sourceCollection from a top-level Collection block", () => {
    const t = template([
      { type: "TourDatesView", props: { sourceCollection: "tour-dates" } },
    ]);
    expect(findCollectionBlockSources(t)).toEqual(["tour-dates"]);
  });

  it("deduplicates multiple blocks targeting the same collection", () => {
    const t = template([
      { type: "TourDatesView", props: { sourceCollection: "tour-dates", limit: 3 } },
      { type: "TourDatesView", props: { sourceCollection: "tour-dates", limit: 5 } },
    ]);
    expect(findCollectionBlockSources(t)).toEqual(["tour-dates"]);
  });

  it("recurses into slot children (Section, Stack)", () => {
    const t = template([
      {
        type: "Section",
        props: {
          children: [
            { type: "TourDatesView", props: { sourceCollection: "tour-dates" } },
            {
              type: "Stack",
              props: {
                children: [
                  { type: "ReleasesView", props: { sourceCollection: "releases" } },
                ],
              },
            },
          ],
        },
      },
    ]);
    expect(findCollectionBlockSources(t)).toEqual(["releases", "tour-dates"]);
  });

  it("ignores blocks with no `sourceCollection` prop", () => {
    const t = template([
      { type: "Text", props: { content: { kind: "literal", value: "Hello" } } },
      { type: "Image", props: { image: { kind: "literal", value: null } } },
    ]);
    expect(findCollectionBlockSources(t)).toEqual([]);
  });
});
