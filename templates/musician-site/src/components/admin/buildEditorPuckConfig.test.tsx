import { describe, expect, it } from "vitest";

import { buildEditorPuckConfig } from "./buildEditorPuckConfig";

import type { CollectionDef } from "@/lib/collections";

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
    const text = config.components.Text;
    const content = text.fields.content;
    expect(content.type).toBe("custom");
  });

  it("Section.children is a slot field for Puck native drag-and-drop", () => {
    const config = buildEditorPuckConfig(def());
    const section = config.components.Section;
    expect(section.fields.children.type).toBe("slot");
  });

  it("RichTextRender.field is a custom field with the collection's richText fields", () => {
    const config = buildEditorPuckConfig(def());
    expect(config.components.RichTextRender.fields.field.type).toBe("custom");
  });

  it("defaultProps for Text wraps the literal in a Bindable", () => {
    const config = buildEditorPuckConfig(def());
    expect(config.components.Text.defaultProps).toMatchObject({
      content: { kind: "literal" },
    });
  });
});
