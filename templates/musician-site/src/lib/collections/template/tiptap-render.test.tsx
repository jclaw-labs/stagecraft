import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { TiptapJSON } from "../schema";
import { renderTiptap } from "./tiptap-render";

function html(doc: TiptapJSON | null | undefined): string {
  return renderToStaticMarkup(<>{renderTiptap(doc)}</>);
}

describe("renderTiptap — block nodes", () => {
  it("returns null for null / undefined / non-doc input", () => {
    expect(renderTiptap(null)).toBeNull();
    expect(renderTiptap(undefined)).toBeNull();
    expect(renderTiptap({ type: "not-doc" } as never)).toBeNull();
  });

  it("renders a paragraph", () => {
    expect(
      html({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] }),
    ).toBe("<p>Hi</p>");
  });

  it("renders headings at the requested level (1-6, clamped)", () => {
    expect(
      html({
        type: "doc",
        content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }],
      }),
    ).toBe("<h1>Title</h1>");

    expect(
      html({
        type: "doc",
        content: [{ type: "heading", attrs: { level: 99 }, content: [{ type: "text", text: "X" }] }],
      }),
    ).toBe("<h2>X</h2>");
  });

  it("renders bullet and ordered lists with list items", () => {
    const doc: TiptapJSON = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
          ],
        },
      ],
    };
    expect(html(doc)).toBe("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
  });

  it("renders blockquote, code block, and hard breaks", () => {
    expect(
      html({
        type: "doc",
        content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }] }],
      }),
    ).toBe("<blockquote><p>q</p></blockquote>");

    expect(
      html({
        type: "doc",
        content: [{ type: "codeBlock", content: [{ type: "text", text: "x = 1" }] }],
      }),
    ).toBe("<pre><code>x = 1</code></pre>");

    expect(
      html({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
        ],
      }),
    ).toBe("<p>a<br/>b</p>");
  });

  it("falls back to a div for unknown block nodes with content", () => {
    expect(
      html({
        type: "doc",
        content: [{ type: "custom-extension-not-implemented", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }],
      }),
    ).toBe("<div><p>x</p></div>");
  });

  it("skips unknown block nodes that carry no content", () => {
    expect(html({ type: "doc", content: [{ type: "custom" }] })).toBe("");
  });
});

describe("renderTiptap — inline marks", () => {
  function wrap(text: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }>): string {
    return html({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text, marks }] }],
    });
  }

  it("renders bold, italic, underline, strike, code", () => {
    expect(wrap("x", [{ type: "bold" }])).toBe("<p><strong>x</strong></p>");
    expect(wrap("x", [{ type: "italic" }])).toBe("<p><em>x</em></p>");
    expect(wrap("x", [{ type: "underline" }])).toBe("<p><u>x</u></p>");
    expect(wrap("x", [{ type: "strike" }])).toBe("<p><s>x</s></p>");
    expect(wrap("x", [{ type: "code" }])).toBe("<p><code>x</code></p>");
  });

  it("nests marks in declaration order (outermost first)", () => {
    expect(wrap("x", [{ type: "bold" }, { type: "italic" }])).toBe(
      "<p><strong><em>x</em></strong></p>",
    );
  });

  it("renders link marks with href and adds rel=noopener noreferrer for target=_blank", () => {
    expect(wrap("x", [{ type: "link", attrs: { href: "https://example.com" } }])).toBe(
      '<p><a href="https://example.com">x</a></p>',
    );
    expect(
      wrap("x", [{ type: "link", attrs: { href: "https://example.com", target: "_blank" } }]),
    ).toBe('<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a></p>');
  });

  it("link without href falls back to '#' (defensive)", () => {
    expect(wrap("x", [{ type: "link" }])).toBe('<p><a href="#">x</a></p>');
  });

  it("drops unknown marks but keeps the inner text", () => {
    expect(wrap("x", [{ type: "custom-mark" }])).toBe("<p>x</p>");
  });
});
