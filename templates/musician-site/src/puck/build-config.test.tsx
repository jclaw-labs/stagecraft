import type { ComponentConfig } from "@puckeditor/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CollectionDef } from "@/lib/collections";

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

type Category = { components?: string[]; visible?: boolean };

function categories(config: { categories?: unknown }) {
  return (config.categories ?? {}) as Record<string, Category | undefined>;
}

/** The blocks the drawer shows: every category except the hidden ones. */
function drawerBlocks(config: { categories?: unknown }): string[] {
  return Object.values(categories(config))
    .filter((c) => c?.visible !== false)
    .flatMap((c) => c?.components ?? [])
    .sort();
}

/** Every block a category names, shown or not. */
function categorisedBlocks(config: { categories?: unknown }): string[] {
  return Object.values(categories(config))
    .flatMap((c) => c?.components ?? [])
    .sort();
}

function fieldType(block: AnyBlock | undefined, prop: string): string | undefined {
  return (block?.fields as Record<string, { type: string }> | undefined)?.[prop]?.type;
}

function renderCanvas(block: AnyBlock | undefined, props: Record<string, unknown>): string {
  if (!block) throw new Error("missing block");
  const Render = block.render as (p: Record<string, unknown>) => React.ReactElement;
  return renderToStaticMarkup(<Render {...block.defaultProps} {...props} />);
}

describe("buildPuckConfig — page editor", () => {
  const embeddable = [
    { slug: "tour-dates", label: "Tour dates" },
    { slug: "store-items", label: "Store items" },
  ];
  const config = buildPuckConfig({ surface: "page", collections: embeddable });
  const c = components(config);

  it("carries the page root fields", () => {
    expect(config.root).toBe(PAGE_ROOT);
  });

  it("offers every library block in the drawer", () => {
    expect(drawerBlocks(config)).toEqual(
      [...libraryNames, "StoreItemsView", "TourDatesView"].sort(),
    );
    expect(categories(config).hidden).toBeUndefined();
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
  const config = buildPuckConfig({ surface: "body" });

  it("registers the library with no page root and no Collection blocks", () => {
    expect(Object.keys(components(config)).sort()).toEqual(libraryNames);
    expect(config.root?.fields).toEqual({});
    expect(categories(config).collections).toBeUndefined();
  });

  it("leaves the forms out of the drawer", () => {
    expect(drawerBlocks(config)).toEqual(
      libraryNames.filter((n) => n !== "ContactForm" && n !== "NewsletterSignup"),
    );
    expect(categories(config).forms).toBeUndefined();
    expect(categories(config).layout?.components).toContain("FullscreenSection");
    // Hidden, not dropped into Puck's visible "Other" group.
    expect(categories(config).hidden).toEqual({
      components: ["ContactForm", "NewsletterSignup"],
      visible: false,
    });
    expect(categorisedBlocks(config)).toEqual(libraryNames);
  });
});

describe("buildPuckConfig — template editors", () => {
  const item = buildPuckConfig({ surface: "item-template", def: def() });
  const c = components(item);

  it("registers the whole library, not a separate primitive set", () => {
    expect(Object.keys(c).sort()).toEqual(libraryNames);
  });

  // An item template repeats once per item in every Collection block.
  it("leaves forms and FullscreenSection out of the item template's drawer", () => {
    const hidden = ["ContactForm", "FullscreenSection", "NewsletterSignup"];
    expect(drawerBlocks(item)).toEqual(libraryNames.filter((n) => !hidden.includes(n)));
    expect(categories(item).hidden).toEqual({
      components: ["ContactForm", "NewsletterSignup", "FullscreenSection"],
      visible: false,
    });
    // Hidden, not unregistered: a template that already holds one still
    // loads, and nothing falls through to Puck's visible "Other" group.
    expect(c.ContactForm).toBe(LIBRARY.ContactForm);
    expect(categorisedBlocks(item)).toEqual(libraryNames);
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
      surface: "item-template",
      def: def(),
      collectionDefs: [def()],
    });
    expect(components(withDefs).TourDatesView).toBeUndefined();
  });

  it("offers a Collection block per collection on a detail template", () => {
    const detail = buildPuckConfig({
      surface: "detail-template",
      def: def(),
      collectionDefs: [def()],
    });
    expect(components(detail).TourDatesView).toBeDefined();
    expect(categories(detail).collections?.components).toEqual(["TourDatesView"]);
    // A detail template renders once per page, so it keeps the full drawer.
    expect(drawerBlocks(detail)).toEqual([...libraryNames, "TourDatesView"].sort());
  });
});
