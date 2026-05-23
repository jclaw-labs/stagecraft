/**
 * End-to-end tests for `<TemplateRenderer>` — driving the full
 * pipeline: walker resolves Bindables, Puck's `<Render>` renders the
 * resolved data, blocks emit React, we assert the static markup.
 *
 * Most assertions check for substrings rather than exact HTML — Puck
 * adds its own wrapper attributes / data-* hooks we don't want to
 * pin down here.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { asImageId } from "@/lib/image-types";

import { binding, literal } from "./binding";
import { TemplateRenderer } from "./renderer";
import type { Template } from "./types";
import type { Item } from "../schema";
import { FIXTURE_TIMESTAMP, tourDatesDef } from "../test-fixtures";

function parisItem(): Item {
  return {
    id: "item_paris-2026",
    slug: "paris-2026",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values: {
      f_date: { type: "date", value: "2026-07-15" },
      f_venue: { type: "text", value: "La Cigale" },
      f_city: { type: "text", value: "Paris" },
      f_status: { type: "select", value: "on_sale" },
      f_url: { type: "url", value: "https://tix.example/paris" },
    },
  };
}

function render(template: Template | null, item: Item = parisItem()): string {
  return renderToStaticMarkup(
    <TemplateRenderer template={template} item={item} collection={tourDatesDef()} />,
  );
}

// ---------------------------------------------------------------------------
// Boundary cases
// ---------------------------------------------------------------------------

describe("TemplateRenderer — boundary cases", () => {
  it("returns nothing for a null template", () => {
    expect(render(null)).toBe("");
  });

  it("renders just Puck's empty wrapper for an empty content array", () => {
    // Puck always wraps its rendered content in a <div>; we don't
    // assert it away, just that no block content leaked through.
    const html = render({ content: [], root: { props: {} } });
    expect(html).not.toContain("<section");
    expect(html).not.toContain("<p");
  });

  it("renders unknown block types as empty (Puck skips them)", () => {
    const html = render({
      content: [{ type: "DoesNotExist", props: {} }],
      root: { props: {} },
    });
    // Puck doesn't render the block but may still emit wrapper markup.
    expect(html).not.toContain("DoesNotExist");
  });
});

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

describe("TemplateRenderer — bindings", () => {
  it("resolves a bound Text against the current item", () => {
    const html = render({
      content: [{ type: "Text", props: { content: binding("f_venue") } }],
      root: { props: {} },
    });
    expect(html).toContain("La Cigale");
  });

  it("Text accepts any string-valued field — date / select / url all render", () => {
    const html = render({
      content: [
        { type: "Text", props: { content: binding("f_date") } },
        { type: "Text", props: { content: binding("f_status") } },
        { type: "Text", props: { content: binding("f_url") } },
      ],
      root: { props: {} },
    });
    expect(html).toContain("2026-07-15");
    expect(html).toContain("on_sale");
    expect(html).toContain("https://tix.example/paris");
  });

  it("hides blocks whose bound field is missing (implicit hide-if-empty)", () => {
    const incomplete: Item = {
      ...parisItem(),
      values: {
        f_date: { type: "date", value: "2026-07-15" },
        f_city: { type: "text", value: "Paris" },
      },
    };
    const html = render(
      {
        content: [
          { type: "Text", props: { content: binding("f_date") } },
          { type: "Text", props: { content: binding("f_venue") } }, // missing
          { type: "Text", props: { content: binding("f_city") } },
        ],
        root: { props: {} },
      },
      incomplete,
    );
    expect(html).toContain("2026-07-15");
    expect(html).toContain("Paris");
    expect(html.match(/<p[^>]*>/g)?.length).toBe(2);
  });

  it("renders literal Bindables verbatim, mixed with bound ones", () => {
    const html = render({
      content: [
        { type: "Text", props: { content: literal("Where:"), variant: "label" } },
        { type: "Text", props: { content: binding("f_venue"), variant: "lead" } },
      ],
      root: { props: {} },
    });
    expect(html).toContain("Where:");
    expect(html).toContain("La Cigale");
    expect(html.indexOf("Where:")).toBeLessThan(html.indexOf("La Cigale"));
  });
});

// ---------------------------------------------------------------------------
// Layout primitives — Section + Stack with children slot
// ---------------------------------------------------------------------------

describe("TemplateRenderer — layout primitives", () => {
  it("renders a tour-date card built from Section + Stack + Text", () => {
    const template: Template = {
      content: [
        {
          type: "Section",
          props: {
            width: "default",
            padding: "default",
            children: [
              {
                type: "Stack",
                props: {
                  direction: "horizontal",
                  gap: "default",
                  align: "center",
                  justify: "between",
                  children: [
                    { type: "Text", props: { content: binding("f_date"), variant: "lead" } },
                    { type: "Text", props: { content: binding("f_venue"), variant: "body" } },
                    { type: "Text", props: { content: binding("f_city"), variant: "small" } },
                  ],
                },
              },
            ],
          },
        },
      ],
      root: { props: {} },
    };
    const html = render(template);
    expect(html).toContain("2026-07-15");
    expect(html).toContain("La Cigale");
    expect(html).toContain("Paris");
    expect(html).toContain("<section");
    // Section wraps the stack
    expect(html.indexOf("<section")).toBeLessThan(html.indexOf("flex-direction:row"));
  });

  it("Section + Stack render even with empty children", () => {
    const html = render({
      content: [
        {
          type: "Section",
          props: {
            children: [{ type: "Stack", props: { children: [] } }],
          },
        },
      ],
      root: { props: {} },
    });
    expect(html).toContain("<section");
    expect(html).toContain("display:flex");
  });
});

// ---------------------------------------------------------------------------
// Image, Button, Link
// ---------------------------------------------------------------------------

describe("TemplateRenderer — content primitives", () => {
  const sampleImage = {
    id: asImageId("abc1234567890def"),
    alt: "Stage photo",
    width: 1600,
    height: 900,
    placeholderDataUri: "data:image/webp;base64,xxx",
    contentSlug: "tour-dates/paris-2026",
    originalExt: "jpg" as const,
  };

  it("Image hides when the bound image field is missing", () => {
    const html = render({
      content: [{ type: "Image", props: { src: binding("f_missing_img") } }],
      root: { props: {} },
    });
    expect(html).not.toContain("<picture");
  });

  it("Image renders a <picture> with the bound image's variants", () => {
    const item: Item = {
      ...parisItem(),
      values: { ...parisItem().values, f_img: { type: "image", value: sampleImage } },
    };
    const html = render(
      {
        content: [{ type: "Image", props: { src: binding("f_img") } }],
        root: { props: {} },
      },
      item,
    );
    expect(html).toContain("<picture");
    expect(html).toContain("/images/tour-dates/paris-2026/");
    expect(html).toContain('alt="Stage photo"');
  });

  it("Image altOverride wins when set", () => {
    const item: Item = {
      ...parisItem(),
      values: { ...parisItem().values, f_img: { type: "image", value: sampleImage } },
    };
    const html = render(
      {
        content: [
          {
            type: "Image",
            props: { src: binding("f_img"), altOverride: literal("Custom alt") },
          },
        ],
        root: { props: {} },
      },
      item,
    );
    expect(html).toContain('alt="Custom alt"');
    expect(html).not.toContain('alt="Stage photo"');
  });

  it("Image altOverride falls back to stored alt when override resolves to empty string", () => {
    const item: Item = {
      ...parisItem(),
      values: { ...parisItem().values, f_img: { type: "image", value: sampleImage } },
    };
    const html = render(
      {
        content: [
          {
            type: "Image",
            props: { src: binding("f_img"), altOverride: literal("") },
          },
        ],
        root: { props: {} },
      },
      item,
    );
    expect(html).toContain('alt="Stage photo"');
  });

  it("Button renders an anchor with bound href and label", () => {
    const html = render({
      content: [
        {
          type: "Button",
          props: {
            label: literal("Buy tickets"),
            href: binding("f_url"),
            variant: "primary",
          },
        },
      ],
      root: { props: {} },
    });
    expect(html).toContain("Buy tickets");
    expect(html).toContain('href="https://tix.example/paris"');
  });

  it("Button hides if either label or href is missing", () => {
    const noUrl: Item = {
      ...parisItem(),
      values: Object.fromEntries(
        Object.entries(parisItem().values).filter(([k]) => k !== "f_url"),
      ) as Item["values"],
    };
    const html = render(
      {
        content: [
          {
            type: "Button",
            props: { label: literal("Buy"), href: binding("f_url") },
          },
        ],
        root: { props: {} },
      },
      noUrl,
    );
    // No anchor for the missing href
    expect(html).not.toContain("Buy");
  });

  it("Link renders a plain anchor", () => {
    const html = render({
      content: [
        {
          type: "Link",
          props: { label: literal("Read more"), href: literal("https://x.com") },
        },
      ],
      root: { props: {} },
    });
    expect(html).toContain('href="https://x.com"');
    expect(html).toContain("Read more");
  });
});

// ---------------------------------------------------------------------------
// RichTextRender
// ---------------------------------------------------------------------------

describe("TemplateRenderer — RichTextRender", () => {
  it("renders the bound richText field's Tiptap content", () => {
    const item: Item = {
      ...parisItem(),
      values: {
        ...parisItem().values,
        f_bio: {
          type: "richText",
          value: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Hello world." }] },
            ],
          },
        },
      },
    };
    const html = render(
      {
        content: [{ type: "RichTextRender", props: { field: "f_bio" } }],
        root: { props: {} },
      },
      item,
    );
    expect(html).toContain("<p>Hello world.</p>");
  });

  it("renders nothing if the field is missing", () => {
    const html = render({
      content: [{ type: "RichTextRender", props: { field: "f_missing" } }],
      root: { props: {} },
    });
    expect(html).not.toContain("<p>");
  });
});

// ---------------------------------------------------------------------------
// Custom registry (PR 7 extension point)
// ---------------------------------------------------------------------------

describe("TemplateRenderer — custom registry", () => {
  it("accepts a custom registry for blocks PR 7 will add", () => {
    const customRegistry = {
      Marker: {
        Component: () => <div data-test="custom-block">marker</div>,
        resolveProps: () => ({}),
        fields: {},
      },
    };
    const html = renderToStaticMarkup(
      <TemplateRenderer
        template={{ content: [{ type: "Marker", props: {} }], root: { props: {} } }}
        item={parisItem()}
        collection={tourDatesDef()}
        registry={customRegistry}
      />,
    );
    expect(html).toContain('data-test="custom-block"');
    expect(html).toContain("marker");
  });
});
