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
    const def = reAdded(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.date, "Date", "fld_new_date");
    const shows = [
      item("later", { ...onSale, fld_new_date: { type: "date", value: "2099-08-01" } }),
      item("past", { ...onSale, fld_new_date: { type: "date", value: "2000-01-01" } }),
      item("sooner", { ...onSale, fld_new_date: { type: "date", value: "2099-07-01" } }),
    ];
    // Upcoming only, soonest first, exactly as with the seed's own field.
    expect(resolve(def, shows)).toEqual(["sooner", "later"]);
  });

  it("still hides every show once the date field is gone with nothing in its place", () => {
    const def: CollectionDef = {
      ...tourDatesCollectionDef,
      fields: tourDatesCollectionDef.fields.filter((f) => f.id !== TOUR_DATES_FIELD_IDS.date),
    };
    const show = item("s", { ...onSale, fld_other: { type: "date", value: "2099-08-01" } });
    expect(resolve(def, [show])).toEqual([]);
  });

  it("keeps the status filter on the deleted id: a fresh status field has no values to filter on", () => {
    // Status opts out of name matching (`matchesByKey: false`): taking
    // over the new field would hide every show without a status while
    // the schema editor reported all clear.
    const def = reAdded(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.status, "status", "fld_new_status");
    const show = item("s", {
      [TOUR_DATES_FIELD_IDS.date]: { type: "date", value: "2099-08-01" },
      fld_new_status: { type: "select", value: "on_sale" },
    });
    expect(resolve(def, [show])).toEqual([]);
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
