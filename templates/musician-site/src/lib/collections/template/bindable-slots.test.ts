import { describe, expect, it } from "vitest";

import {
  BINDABLE_SLOTS,
  bindableFieldsByKind,
  compatibleFields,
  isFieldTypeCompatible,
} from "./bindable-slots";
import type { CollectionDef } from "../schema";
import { BLOCKS } from "@/puck/config";

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

describe("richText slots", () => {
  it("accept richText fields and every string-valued field", () => {
    const got = compatibleFields("richText", def().fields).map((f) => f.key);
    expect(got).toEqual(["date", "venue", "city", "body"]);
  });

  it("reject image and number fields", () => {
    expect(isFieldTypeCompatible("richText", "image")).toBe(false);
    expect(isFieldTypeCompatible("richText", "number")).toBe(false);
  });
});

describe("BINDABLE_SLOTS", () => {
  it("names the unified library's bindable props", () => {
    expect(BINDABLE_SLOTS.Text.content.slotKind).toBe("string");
    expect(BINDABLE_SLOTS.Image.image.slotKind).toBe("image");
    expect(BINDABLE_SLOTS.Button.text.slotKind).toBe("string");
    expect(BINDABLE_SLOTS.RichText.text.slotKind).toBe("richText");
  });

  it("names only blocks and props the block library defines", () => {
    // A rename in config.tsx must fail here, not silently stop resolving
    // bindings, swapping pickers and checking orphans for that prop.
    const blocks = BLOCKS as unknown as Record<string, { fields?: Record<string, unknown> }>;
    for (const [blockName, slots] of Object.entries(BINDABLE_SLOTS)) {
      expect(blocks[blockName], blockName).toBeDefined();
      for (const propName of Object.keys(slots)) {
        expect(blocks[blockName]!.fields?.[propName], `${blockName}.${propName}`).toBeDefined();
      }
    }
  });

  it("keeps the image when only its alt override fails to resolve", () => {
    expect(BINDABLE_SLOTS.Image.image.hidesBlockWhenUnbound).toBe(true);
    expect(BINDABLE_SLOTS.Image.altOverride.hidesBlockWhenUnbound).toBe(false);
  });
});

describe("bindableFieldsByKind", () => {
  it("partitions a collection's fields into pickable slices", () => {
    const got = bindableFieldsByKind(def());
    expect(got.string.map((f) => f.key)).toEqual(["date", "venue", "city"]);
    expect(got.image.map((f) => f.key)).toEqual(["image"]);
    expect(got.richText.map((f) => f.key)).toEqual(["date", "venue", "city", "body"]);
  });
});
