import { describe, expect, it } from "vitest";

import { buildCollectionViewComponentConfig } from "./collection-view-editor";

describe("buildCollectionViewComponentConfig", () => {
  it("exposes a limit control + a read-only source note + a placeholder render", () => {
    const cfg = buildCollectionViewComponentConfig("tour-dates", "Tour dates");
    expect(cfg.fields?.limit).toMatchObject({ type: "number" });
    expect(cfg.fields?.sourceCollection).toMatchObject({ type: "custom" });
    expect(typeof cfg.render).toBe("function");
  });

  it("seeds defaultProps from the shared collectionViewProps (source + sort + filter)", () => {
    const cfg = buildCollectionViewComponentConfig("tour-dates", "Tour dates");
    expect(cfg.defaultProps).toMatchObject({
      sourceCollection: "tour-dates",
      limit: 5,
      sort: { direction: "asc" },
      filter: { all: expect.any(Array) },
    });
  });

  it("gives an arbitrary collection source + limit only, default limit 6", () => {
    const cfg = buildCollectionViewComponentConfig("store-items", "Store items");
    expect(cfg.defaultProps).toEqual({ sourceCollection: "store-items", limit: 6 });
  });
});
