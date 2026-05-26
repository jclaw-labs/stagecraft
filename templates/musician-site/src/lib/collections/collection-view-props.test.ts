import { describe, expect, it } from "vitest";

import {
  collectionViewProps,
  defaultCollectionViewLimit,
} from "./collection-view-props";
import { POSTS_FIELD_IDS, RELEASES_FIELD_IDS, TOUR_DATES_FIELD_IDS } from "./field-ids";

describe("collectionViewProps", () => {
  it("gives tour-dates the upcoming + not-cancelled filter, soonest-first", () => {
    const props = collectionViewProps("tour-dates", 5);
    expect(props).toEqual({
      sourceCollection: "tour-dates",
      limit: 5,
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
    });
  });

  it("sorts releases newest-first by release date, no filter", () => {
    const props = collectionViewProps("releases", 8);
    expect(props).toEqual({
      sourceCollection: "releases",
      limit: 8,
      sort: { fieldId: RELEASES_FIELD_IDS.releaseDate, direction: "desc" },
    });
    expect(props).not.toHaveProperty("filter");
  });

  it("sorts posts newest-first by published date, no filter", () => {
    const props = collectionViewProps("posts", 6);
    expect(props).toEqual({
      sourceCollection: "posts",
      limit: 6,
      sort: { fieldId: POSTS_FIELD_IDS.publishedAt, direction: "desc" },
    });
    expect(props).not.toHaveProperty("filter");
  });

  it("gives an arbitrary collection just source + limit (no opinionated sort/filter)", () => {
    const props = collectionViewProps("store-items", 4);
    expect(props).toEqual({ sourceCollection: "store-items", limit: 4 });
  });

  it("never includes a block id — callers spread their own", () => {
    for (const slug of ["tour-dates", "releases", "posts", "store-items"]) {
      expect(collectionViewProps(slug, 3)).not.toHaveProperty("id");
    }
  });
});

describe("defaultCollectionViewLimit", () => {
  it("uses the per-demo defaults", () => {
    expect(defaultCollectionViewLimit("tour-dates")).toBe(5);
    expect(defaultCollectionViewLimit("releases")).toBe(8);
    expect(defaultCollectionViewLimit("posts")).toBe(6);
  });

  it("falls back to 6 for any other collection", () => {
    expect(defaultCollectionViewLimit("store-items")).toBe(6);
    expect(defaultCollectionViewLimit("photos")).toBe(6);
  });
});
