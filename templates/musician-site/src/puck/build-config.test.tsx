import type { ComponentConfig } from "@puckeditor/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CollectionDef } from "@/lib/collections";
import { CollectionBlockRender } from "@/lib/collections/template/collection-block";

import { buildPuckConfig } from "./build-config";
import { BLOCK_CATEGORIES, BLOCKS, PAGE_ROOT } from "./config";

type AnyBlock = ComponentConfig<Record<string, unknown>>;

function def(): CollectionDef {
  return {
    schemaVersion: 1,
    slug: "tour-dates",
    singularName: "Tour Date",
    pluralName: "Tour Dates",
    isSingleton: false,
    fields: [
      { id: "f_date", key: "date", type: "date", required: true },
      { id: "f_venue", key: "venue", type: "text", required: true },
      { id: "f_image", key: "image", type: "image", required: false },
      { id: "f_body", key: "body", type: "richText", required: false },
    ],
    slugSourceFieldId: "f_venue",
    detailUrlPrefix: "/tour-dates",
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
  };
}

const LIBRARY = BLOCKS as unknown as Record<string, AnyBlock>;
const libraryNames = Object.keys(LIBRARY).sort();

function components(config: { components: unknown }): Record<string, AnyBlock> {
  return config.components as Record<string, AnyBlock>;
}

function categories(config: { categories?: unknown }) {
  return (config.categories ?? {}) as Record<string, { components?: string[] } | undefined>;
}

function fieldType(block: AnyBlock | undefined, prop: string): string | undefined {
  return (block?.fields as Record<string, { type: string }> | undefined)?.[prop]?.type;
}

function renderCanvas(block: AnyBlock | undefined, props: Record<string, unknown>): string {
  if (!block) throw new Error("missing block");
  const Render = block.render as (p: Record<string, unknown>) => React.ReactElement;
  return renderToStaticMarkup(<Render {...block.defaultProps} {...props} />);
}

describe("buildPuckConfig — render", () => {
  it("renders every library block with the library's own render", () => {
    const c = components(buildPuckConfig({ variant: "render" }));
    for (const name of libraryNames) expect(c[name]?.render).toBe(LIBRARY[name].render);
  });

  it("registers a Collection block per slug, and none without slugs", () => {
    const withSlugs = components(
      buildPuckConfig({ variant: "render", collectionSlugs: ["tour-dates", "store-items"] }),
    );
    expect(withSlugs.TourDatesView?.render).toBe(CollectionBlockRender);
    expect(withSlugs.StoreItemsView?.render).toBe(CollectionBlockRender);
    expect(Object.keys(components(buildPuckConfig({ variant: "render" }))).sort()).toEqual(
      libraryNames,
    );
  });

  it("returns the same config for the same slug set", () => {
    expect(buildPuckConfig({ variant: "render", collectionSlugs: ["a", "b"] })).toBe(
      buildPuckConfig({ variant: "render", collectionSlugs: ["b", "a"] }),
    );
  });
});

describe("buildPuckConfig — page editor", () => {
  const embeddable = [
    { slug: "tour-dates", label: "Tour dates" },
    { slug: "store-items", label: "Store items" },
  ];
  const config = buildPuckConfig({ variant: "editor", surface: "page", collections: embeddable });
  const c = components(config);

  it("carries the page root fields", () => {
    expect(config.root).toBe(PAGE_ROOT);
  });

  it("uses the library blocks unchanged (plain literal fields)", () => {
    for (const name of libraryNames) expect(c[name]).toBe(LIBRARY[name]);
    expect(fieldType(c.Button, "text")).toBe("text");
  });

  it("adds a placeholder Collection block per embeddable collection, in their own category", () => {
    expect(
      (c.TourDatesView?.defaultProps as { sourceCollection?: string }).sourceCollection,
    ).toBe("tour-dates");
    expect(c.StoreItemsView).toBeDefined();
    expect(categories(config).collections?.components).toEqual(["TourDatesView", "StoreItemsView"]);
    expect(categories(config).media?.components).toEqual(
      (BLOCK_CATEGORIES as Record<string, { components?: string[] }>).media.components,
    );
  });
});

describe("buildPuckConfig — item body editor", () => {
  const config = buildPuckConfig({ variant: "editor", surface: "body" });

  it("offers the library with no page root and no Collection blocks", () => {
    expect(Object.keys(components(config)).sort()).toEqual(libraryNames);
    expect(config.root?.fields).toEqual({});
    expect(categories(config).collections).toBeUndefined();
  });
});

describe("buildPuckConfig — template editors", () => {
  const item = buildPuckConfig({ variant: "editor", surface: "item-template", def: def() });
  const c = components(item);

  it("offers the whole library, not a separate primitive set", () => {
    expect(Object.keys(c).sort()).toEqual(libraryNames);
  });

  it("swaps bindable props for pickers and leaves the rest of the block alone", () => {
    expect(fieldType(c.Button, "text")).toBe("custom");
    expect(fieldType(c.Button, "href")).toBe("custom");
    expect(fieldType(c.Button, "variant")).toBe("select");
    expect(fieldType(c.Image, "image")).toBe("custom");
    expect(fieldType(c.RichText, "text")).toBe("custom");
    expect(fieldType(c.Section, "children")).toBe("slot");
    expect(c.Heading).toBe(LIBRARY.Heading);
  });

  it("shows a bound prop as {fieldKey} on the canvas and a wrapped literal as itself", () => {
    expect(renderCanvas(c.Button, { text: { kind: "binding", fieldId: "f_venue" } })).toContain(
      "{venue}",
    );
    expect(renderCanvas(c.Button, { text: { kind: "literal", value: "Tickets" } })).toContain(
      "Tickets",
    );
    expect(renderCanvas(c.Text, { content: "Plain" })).toContain("Plain");
  });

  it("shows an image binding as the empty-image placeholder", () => {
    const html = renderCanvas(c.Image, { image: { kind: "binding", fieldId: "f_image" } });
    expect(html).toContain("linear-gradient");
  });

  // ADR §4.3 cycle safety: itemTemplates render inside Collection blocks, so
  // an item template that could embed one would recurse.
  it("never offers Collection blocks on an item template", () => {
    const withDefs = buildPuckConfig({
      variant: "editor",
      surface: "item-template",
      def: def(),
      collectionDefs: [def()],
    });
    expect(components(withDefs).TourDatesView).toBeUndefined();
  });

  it("offers a Collection block per collection on a detail template", () => {
    const detail = buildPuckConfig({
      variant: "editor",
      surface: "detail-template",
      def: def(),
      collectionDefs: [def()],
    });
    expect(components(detail).TourDatesView).toBeDefined();
    expect(categories(detail).collections?.components).toEqual(["TourDatesView"]);
  });
});
