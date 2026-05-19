import type { Config } from "@measured/puck";
import { describe, expect, it } from "vitest";

import { buildEditorPuckConfig } from "./buildEditorPuckConfig";

import type { CollectionDef } from "@/lib/collections";

/**
 * Puck's `Config["components"][name].fields` is optional. Every block
 * the builder produces sets it, so the test asserts that and narrows.
 */
function fieldsOf(
  config: Config,
  name: string,
): Record<string, { type: string }> {
  const block = config.components[name];
  if (!block) throw new Error(`Missing block "${name}" in config`);
  if (!block.fields) throw new Error(`Block "${name}" has no fields`);
  return block.fields as Record<string, { type: string }>;
}

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

describe("buildEditorPuckConfig", () => {
  it("registers the seven Primitive blocks", () => {
    const config = buildEditorPuckConfig(def());
    expect(Object.keys(config.components).sort()).toEqual(
      ["Button", "Image", "Link", "RichTextRender", "Section", "Stack", "Text"].sort(),
    );
  });

  it("Text.content is a custom field (BindableStringPicker)", () => {
    const config = buildEditorPuckConfig(def());
    expect(fieldsOf(config, "Text").content.type).toBe("custom");
  });

  it("Section.children is a slot field for Puck native drag-and-drop", () => {
    const config = buildEditorPuckConfig(def());
    expect(fieldsOf(config, "Section").children.type).toBe("slot");
  });

  it("RichTextRender.field is a custom field with the collection's richText fields", () => {
    const config = buildEditorPuckConfig(def());
    expect(fieldsOf(config, "RichTextRender").field.type).toBe("custom");
  });

  it("defaultProps for Text wraps the literal in a Bindable", () => {
    const config = buildEditorPuckConfig(def());
    expect(config.components.Text.defaultProps).toMatchObject({
      content: { kind: "literal" },
    });
  });

  // ADR §4.3 cycle-safety gate. itemTemplates can't contain Collection
  // blocks; the editor surface enforces this by ignoring `extraBlocks`
  // when `kind === "item"`. A regression that inverts this gate would
  // let an itemTemplate embed Collection blocks that re-render
  // itemTemplates → infinite recursion at render time.
  describe("cycle-safety gate (kind + extraBlocks)", () => {
    const fakeBlock = { fields: {}, defaultProps: {}, render: () => <span /> };

    it("defaults to item kind — extraBlocks ignored even if passed", () => {
      const config = buildEditorPuckConfig(def(), {
        extraBlocks: { TourDatesView: fakeBlock },
      });
      expect(config.components).not.toHaveProperty("TourDatesView");
    });

    it("kind: item ignores extraBlocks", () => {
      const config = buildEditorPuckConfig(def(), {
        kind: "item",
        extraBlocks: { TourDatesView: fakeBlock, PagesView: fakeBlock },
      });
      expect(config.components).not.toHaveProperty("TourDatesView");
      expect(config.components).not.toHaveProperty("PagesView");
    });

    it("kind: detail registers every extraBlocks entry alongside primitives", () => {
      const config = buildEditorPuckConfig(def(), {
        kind: "detail",
        extraBlocks: { TourDatesView: fakeBlock, PagesView: fakeBlock },
      });
      expect(config.components).toHaveProperty("TourDatesView");
      expect(config.components).toHaveProperty("PagesView");
      // Primitives still present.
      expect(config.components).toHaveProperty("Text");
      expect(config.components).toHaveProperty("Section");
    });

    it("kind: detail with no extraBlocks is the primitive set", () => {
      const config = buildEditorPuckConfig(def(), { kind: "detail" });
      expect(Object.keys(config.components).sort()).toEqual(
        ["Button", "Image", "Link", "RichTextRender", "Section", "Stack", "Text"].sort(),
      );
    });
  });
});
