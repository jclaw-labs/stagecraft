import { describe, expect, it } from "vitest";

import { blockNameForCollection } from "@/lib/collections/template/collection-block";

import {
  buildCollectionViewComponentConfig,
  buildUnifiedEditorConfig,
} from "./collection-view-editor";
import { puckConfig } from "./config";

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

describe("buildUnifiedEditorConfig", () => {
  const embeddable = [
    { slug: "tour-dates", label: "Tour dates" },
    { slug: "releases", label: "Releases" },
    { slug: "posts", label: "Posts" },
    { slug: "store-items", label: "Store items" },
  ];
  const config = buildUnifiedEditorConfig(embeddable);
  const c = config.components as Record<
    string,
    { render?: unknown; defaultProps?: { sourceCollection?: string } } | undefined
  >;
  const pc = puckConfig.components as Record<string, { render?: unknown }>;

  it("keeps the chrome blocks with their puckConfig render", () => {
    expect(c.Section?.render).toBe(pc.Section.render);
    expect(c.Heading?.render).toBe(pc.Heading.render);
  });

  it("registers the generic *View blocks with the authoring config (bespoke ones deleted)", () => {
    // Post-ADR-015 PR-6 the bespoke blocks are gone from puckConfig; the `*View`
    // names now resolve solely to the generic authoring config.
    expect(pc.TourDatesView).toBeUndefined();
    expect(c.TourDatesView?.render).toBeTypeOf("function");
    expect(c.TourDatesView?.defaultProps?.sourceCollection).toBe("tour-dates");
    expect(c.ReleasesView?.defaultProps?.sourceCollection).toBe("releases");
    expect(c.PostsView?.defaultProps?.sourceCollection).toBe("posts");
  });

  it("registers a generic block for an artist collection beyond the three demos", () => {
    const name = blockNameForCollection("store-items"); // StoreItemsView
    expect(c[name]).toBeDefined();
    expect(c[name]?.defaultProps?.sourceCollection).toBe("store-items");
  });

  it("rebuilds the Collections drawer category to list every embeddable block", () => {
    const cats = config.categories as Record<string, { components?: string[] } | undefined>;
    expect(cats.collections?.components).toEqual([
      "TourDatesView",
      "ReleasesView",
      "PostsView",
      blockNameForCollection("store-items"),
    ]);
  });

  it("preserves the other puckConfig drawer categories", () => {
    const cats = config.categories as Record<string, { components?: string[] } | undefined>;
    const base = puckConfig.categories as Record<string, { components?: string[] } | undefined>;
    expect(cats.media?.components).toEqual(base.media?.components);
  });
});
