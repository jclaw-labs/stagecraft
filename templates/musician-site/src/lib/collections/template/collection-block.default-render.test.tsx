import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DefaultItemFieldsList } from "./collection-block";
import type { CollectionDef, Item } from "../schema";
import { asImageId } from "@/lib/image-types";

const IMAGE_FIXTURE = {
  id: asImageId("abc1234567890def"),
  alt: "Cover",
  width: 1600,
  height: 1067,
  placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
  contentSlug: "cover",
  originalExt: "jpg" as const,
};

const STORE_ITEMS_DEF: CollectionDef = {
  schemaVersion: 1,
  slug: "store-items",
  singularName: "store item",
  pluralName: "store items",
  fields: [
    { id: "f_title", key: "title", type: "text", required: true },
    { id: "f_image", key: "image", type: "image", required: true },
    { id: "f_price", key: "price", type: "number", required: true },
    { id: "f_externalUrl", key: "externalUrl", type: "url", required: true },
  ],
  slugSourceFieldId: "f_title",
  detailUrlPrefix: null,
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

const STORE_ITEM: Item = {
  id: "item_test",
  slug: "shirt",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  values: {
    f_title: { type: "text", value: "Tour Shirt" },
    f_image: { type: "image", value: IMAGE_FIXTURE },
    f_price: { type: "number", value: 25 },
    f_externalUrl: {
      type: "url",
      value: "https://artist.bandcamp.com/merch/tour-shirt",
    },
  },
};

function render(item: Item, def: CollectionDef) {
  return renderToStaticMarkup(<DefaultItemFieldsList item={item} def={def} />);
}

describe("DefaultItemFieldsList — default render of a collection item", () => {
  it("renders image values as <picture> instead of skipping them", () => {
    const html = render(STORE_ITEM, STORE_ITEMS_DEF);
    // Without the fix, the image field was silently dropped because
    // `scalarSortKey` returns null for image values. Result: photo
    // galleries / store grids had no images out of the box.
    expect(html).toMatch(/<picture>/);
    expect(html).toContain(`alt="Cover"`);
  });

  it("renders url values as clickable links", () => {
    const html = render(STORE_ITEM, STORE_ITEMS_DEF);
    // Before: `externalUrl` rendered as the bare URL string inside a
    // <p>. Now: a real anchor so "buy" links from the default render
    // are actually clickable.
    expect(html).toContain(
      `<a href="https://artist.bandcamp.com/merch/tour-shirt"`,
    );
    expect(html).toContain("https://artist.bandcamp.com/merch/tour-shirt</a>");
  });

  it("still renders ordinary scalar fields (text, number) as before", () => {
    const html = render(STORE_ITEM, STORE_ITEMS_DEF);
    expect(html).toContain("Tour Shirt");
    expect(html).toContain("25");
  });

  it("skips fields whose item value is undefined", () => {
    const partial: Item = {
      ...STORE_ITEM,
      values: { f_title: { type: "text", value: "Only title" } },
    };
    const html = render(partial, STORE_ITEMS_DEF);
    expect(html).toContain("Only title");
    expect(html).not.toMatch(/<picture>/);
    expect(html).not.toContain("<a href");
  });
});
