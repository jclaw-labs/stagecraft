import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";

import { BLOCKS } from "./config";
import { buildRenderConfig, CollectionBlockRender } from "./render-config";

type AnyBlock = ComponentConfig<Record<string, unknown>>;

const LIBRARY = BLOCKS as unknown as Record<string, AnyBlock>;
const libraryNames = Object.keys(LIBRARY).sort();

function components(config: { components: unknown }): Record<string, AnyBlock> {
  return config.components as Record<string, AnyBlock>;
}

describe("buildRenderConfig", () => {
  it("renders every library block with the library's own render", () => {
    const c = components(buildRenderConfig());
    for (const name of libraryNames) expect(c[name]?.render).toBe(LIBRARY[name].render);
  });

  it("registers a Collection block per slug, and none without slugs", () => {
    const withSlugs = components(buildRenderConfig(["tour-dates", "store-items"]));
    expect(withSlugs.TourDatesView?.render).toBe(CollectionBlockRender);
    expect(withSlugs.StoreItemsView?.render).toBe(CollectionBlockRender);
    expect(Object.keys(components(buildRenderConfig())).sort()).toEqual(libraryNames);
  });

  it("returns the same config for the same slug set", () => {
    expect(buildRenderConfig(["a", "b"])).toBe(buildRenderConfig(["b", "a"]));
  });
});
