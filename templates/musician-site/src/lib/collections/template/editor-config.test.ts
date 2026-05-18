import { describe, expect, it } from "vitest";

import {
  BINDABLE_SLOTS,
  RICH_FIELDS,
  compatibleFields,
  defaultBindable,
  getCollectionContextForEditor,
} from "./editor-config";
import type { CollectionDef } from "../schema";

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
      { id: "f_city", key: "city", type: "text", required: false },
      { id: "f_image", key: "image", type: "image", required: false },
      { id: "f_body", key: "body", type: "richText", required: false },
      { id: "f_count", key: "count", type: "number", required: false },
    ],
    slugSourceFieldId: "f_venue",
    detailUrlPrefix: "/tour-dates",
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
  };
}

describe("compatibleFields", () => {
  it("string slot accepts text-like fields, rejects image / richText / number", () => {
    const got = compatibleFields("string", def().fields).map((f) => f.key);
    expect(got).toEqual(["date", "venue", "city"]);
  });

  it("image slot accepts only image fields", () => {
    const got = compatibleFields("image", def().fields).map((f) => f.key);
    expect(got).toEqual(["image"]);
  });
});

describe("defaultBindable", () => {
  it("starts in literal mode with the provided value", () => {
    const b = defaultBindable("Hello");
    expect(b).toEqual({ kind: "literal", value: "Hello" });
  });
});

describe("BINDABLE_SLOTS / RICH_FIELDS", () => {
  it("declares Text.content as a string slot", () => {
    expect(BINDABLE_SLOTS.Text.content.slotKind).toBe("string");
  });

  it("declares Image.src as an image slot", () => {
    expect(BINDABLE_SLOTS.Image.src.slotKind).toBe("image");
  });

  it("declares RichTextRender.field as a richText-only picker", () => {
    expect(RICH_FIELDS.RichTextRender.field.fieldType).toBe("richText");
  });
});

describe("getCollectionContextForEditor", () => {
  it("partitions a collection's fields into pickable slices", () => {
    const ctx = getCollectionContextForEditor(def());
    expect(ctx.stringFields.map((f) => f.key)).toEqual(["date", "venue", "city"]);
    expect(ctx.imageFields.map((f) => f.key)).toEqual(["image"]);
    expect(ctx.richTextFields.map((f) => f.key)).toEqual(["body"]);
  });
});
