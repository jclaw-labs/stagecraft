import { describe, expect, it } from "vitest";

import {
  blockNameForCollection,
  resolveCollectionBlockProps,
  type CollectionBlockRawProps,
} from "./collection-block";
import type { CollectionDef, Item } from "../schema";
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
