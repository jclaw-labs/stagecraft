import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BindableStringPicker, BindableImagePicker } from "./BindablePicker";

import type { FieldDef } from "@/lib/collections";

const STRING_FIELDS: FieldDef[] = [
  { id: "f_title", key: "title", type: "text", required: true },
  { id: "f_venue", key: "venue", type: "text", required: false },
];

const IMAGE_FIELDS: FieldDef[] = [
  { id: "f_hero", key: "heroImage", type: "image", required: false },
];

describe("<BindableStringPicker>", () => {
  it("renders a text input in literal mode", () => {
    const html = renderToStaticMarkup(
      <BindableStringPicker
        value={{ kind: "literal", value: "hello" }}
        onChange={vi.fn()}
        stringFields={STRING_FIELDS}
      />,
    );
    expect(html).toContain('value="hello"');
    expect(html).toMatch(/<input[^>]*type="text"/);
    // The field dropdown should not be visible in literal mode.
    expect(html).not.toContain("Pick a field…");
  });

  it("renders the field dropdown in binding mode and selects the bound field", () => {
    const html = renderToStaticMarkup(
      <BindableStringPicker
        value={{ kind: "binding", fieldId: "f_venue" }}
        onChange={vi.fn()}
        stringFields={STRING_FIELDS}
      />,
    );
    expect(html).toContain("<select");
    expect(html).toContain("Pick a field…");
    expect(html).toContain("title (text)");
    expect(html).toContain("venue (text)");
    expect(html).toContain('value="f_venue" selected');
  });

  it("marks the active mode button visually", () => {
    const literalHtml = renderToStaticMarkup(
      <BindableStringPicker
        value={{ kind: "literal", value: "" }}
        onChange={vi.fn()}
        stringFields={STRING_FIELDS}
      />,
    );
    // The active button's <button style> contains the action-fg color
    // followed by the "Literal" text. The inactive one has --color-text
    // followed by "From field".
    expect(literalHtml).toMatch(/color:var\(--color-action-fg\)[^<]*">Literal/);
    expect(literalHtml).toMatch(/color:var\(--color-text\)[^<]*">From field/);

    const bindingHtml = renderToStaticMarkup(
      <BindableStringPicker
        value={{ kind: "binding", fieldId: "f_title" }}
        onChange={vi.fn()}
        stringFields={STRING_FIELDS}
      />,
    );
    expect(bindingHtml).toMatch(/color:var\(--color-text\)[^<]*">Literal/);
    expect(bindingHtml).toMatch(/color:var\(--color-action-fg\)[^<]*">From field/);
  });
});

describe("<BindableImagePicker>", () => {
  it("shows the file picker chrome in literal mode", () => {
    const html = renderToStaticMarkup(
      <BindableImagePicker
        value={{ kind: "literal", value: null }}
        onChange={vi.fn()}
        imageFields={IMAGE_FIELDS}
      />,
    );
    // The literal mode renders <ImagePickerField>; we don't assert on
    // its internals (those are tested separately) — just that the
    // mode toggle is present and the dropdown isn't.
    expect(html).toContain("Literal");
    expect(html).toContain("From field");
    expect(html).not.toContain("Pick a field…");
  });

  it("shows the image-field dropdown in binding mode", () => {
    const html = renderToStaticMarkup(
      <BindableImagePicker
        value={{ kind: "binding", fieldId: "f_hero" }}
        onChange={vi.fn()}
        imageFields={IMAGE_FIELDS}
      />,
    );
    expect(html).toContain("heroImage (image)");
    expect(html).toContain('value="f_hero" selected');
  });
});

describe("<BindableStringPicker isMultiline>", () => {
  it("edits a literal in a textarea", () => {
    const html = renderToStaticMarkup(
      <BindableStringPicker
        value={{ kind: "literal", value: "Line one" }}
        onChange={vi.fn()}
        stringFields={STRING_FIELDS}
        isMultiline
      />,
    );
    expect(html).toContain("<textarea");
    expect(html).toContain("Line one");
  });
});
