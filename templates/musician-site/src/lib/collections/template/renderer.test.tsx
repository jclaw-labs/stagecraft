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
import { blockNameForCollection } from "./collection-block";
import { resolveTemplate, TemplateRenderer } from "./renderer";
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

const EMPTY_TEMPLATE: Template = { content: [], root: { props: {} } };

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
// Walker: slot recursion through unknown (page chrome) blocks
// ---------------------------------------------------------------------------

// ADR-015: hand-authored pages embed Collection blocks / bound blocks inside
// layout blocks (Section, Columns). The walker descends into every array of
// nested blocks, whatever the block, so the nested blocks resolve.
type ChildSlot = { props: { children: Array<{ type: string; props: Record<string, unknown> }> } };

describe("resolveTemplate — recurses every block's slots", () => {
  it("resolves a bound block nested in a Section's slot array", () => {
    const tpl: Template = {
      content: [
        {
          type: "Section",
          props: { id: "s1", children: [{ type: "Text", props: { content: binding("f_venue") } }] },
        },
      ],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem());
    const section = resolved.content[0] as unknown as ChildSlot;
    // The inner Text's binding resolved to a literal string.
    expect(section.props.children[0].props.content).toBe("La Cigale");
  });

  it("recurses deeply (bound block two levels down)", () => {
    const tpl: Template = {
      content: [
        {
          type: "Section",
          props: {
            children: [
              { type: "Columns", props: { col1: [{ type: "Text", props: { content: binding("f_city") } }] } },
            ],
          },
        },
      ],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem());
    const col1 = (resolved.content[0] as unknown as ChildSlot).props.children[0].props.col1 as Array<{
      props: { content: unknown };
    }>;
    expect(col1[0].props.content).toBe("Paris");
  });

  it("leaves non-block array props (a data list, not a slot) untouched", () => {
    const tpl: Template = {
      content: [
        // `images` items have no `type` → they're data, not blocks; left as-is.
        { type: "Gallery", props: { id: "g1", images: [{ image: null }, { image: null }] } },
      ],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem());
    const gallery = resolved.content[0] as unknown as { props: { images: unknown[] } };
    expect(gallery.props.images).toEqual([{ image: null }, { image: null }]);
  });

  it("leaves a block with no slots or bindings unchanged", () => {
    const tpl: Template = {
      content: [{ type: "Divider", props: { id: "d1", inset: true } }],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem());
    expect(resolved.content[0]).toEqual({ type: "Divider", props: { id: "d1", inset: true } });
  });

  it("resolves a Collection block nested in chrome (the convergence target)", () => {
    const tpl: Template = {
      content: [
        {
          type: "Section",
          props: {
            children: [
              {
                type: blockNameForCollection("tour-dates"), // "TourDatesView"
                props: { sourceCollection: "tour-dates", limit: 5 },
              },
            ],
          },
        },
      ],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem(), {
      collectionSlugs: ["tour-dates"],
      loadedCollections: { "tour-dates": { def: tourDatesDef(), items: [parisItem()] } },
    });
    const view = (resolved.content[0] as unknown as ChildSlot).props.children[0];
    // resolveCollectionBlockProps injected the loaded items + sourceDef.
    expect((view.props as { items: unknown[] }).items).toHaveLength(1);
    expect((view.props as { sourceDef: { slug: string } }).sourceDef.slug).toBe("tour-dates");
  });

  it("handles a block carrying both a slot array and a data array in one pass", () => {
    const tpl: Template = {
      content: [
        {
          type: "Frame", // not in the library; a slot AND a data array side by side
          props: {
            children: [{ type: "Text", props: { content: binding("f_venue") } }],
            images: [{ image: null }],
          },
        },
      ],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem());
    const frame = resolved.content[0] as unknown as ChildSlot & { props: { images: unknown[] } };
    expect(frame.props.children[0].props.content).toBe("La Cigale"); // slot resolved
    expect(frame.props.images).toEqual([{ image: null }]); // data array untouched
  });

  it("leaves an empty slot array empty", () => {
    const tpl: Template = {
      content: [{ type: "Section", props: { children: [] } }],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem());
    expect((resolved.content[0] as unknown as ChildSlot).props.children).toEqual([]);
  });

  it("preserves a resolved block's `id` (Puck keys rendered blocks by it)", () => {
    // resolveProps returns only render fields (no id); resolveBlock carries the
    // original `id` through so Puck can key the block (no React key warning).
    const tpl: Template = {
      content: [{ type: "Text", props: { id: "t1", content: binding("f_venue") } }],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem());
    const text = resolved.content[0] as { props: { id?: string; content?: unknown } };
    expect(text.props.id).toBe("t1");
    expect(text.props.content).toBe("La Cigale");
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
            width: "md",
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
      content: [{ type: "Image", props: { image: binding("f_missing_img") } }],
      root: { props: {} },
    });
    // The whole block is dropped — not swapped for the gradient placeholder.
    expect(html).toBe(render(EMPTY_TEMPLATE));
  });

  it("Image renders a <picture> with the bound image's variants", () => {
    const item: Item = {
      ...parisItem(),
      values: { ...parisItem().values, f_img: { type: "image", value: sampleImage } },
    };
    const html = render(
      {
        content: [{ type: "Image", props: { image: binding("f_img") } }],
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
            props: { image: binding("f_img"), altOverride: literal("Custom alt") },
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
            props: { image: binding("f_img"), altOverride: literal("") },
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
            text: literal("Buy tickets"),
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

  it("Button hides if either text or href is bound to a missing field", () => {
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
            props: { text: literal("Buy"), href: binding("f_url") },
          },
        ],
        root: { props: {} },
      },
      noUrl,
    );
    // No anchor for the missing href
    expect(html).not.toContain("Buy");
  });

  it("Button hides if text or href is bound to a field holding an empty string", () => {
    const empties: Item = {
      ...parisItem(),
      values: {
        ...parisItem().values,
        f_venue: { type: "text", value: "" },
        f_url: { type: "url", value: "" },
      },
    };
    const template = (props: Record<string, unknown>): Template => ({
      content: [{ type: "Button", props }],
      root: { props: {} },
    });
    expect(render(template({ text: literal("Tickets"), href: binding("f_url") }), empties)).toBe(
      render(EMPTY_TEMPLATE),
    );
    expect(
      render(template({ text: binding("f_venue"), href: "https://tix.example" }), empties),
    ).toBe(render(EMPTY_TEMPLATE));
  });

  it("Button keeps a literal empty string — only an empty binding hides", () => {
    const html = render({
      content: [{ type: "Button", props: { text: "Tickets", href: "" } }],
      root: { props: {} },
    });
    expect(html).toContain("Tickets");
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
// RichText bound to a field
// ---------------------------------------------------------------------------

describe("TemplateRenderer — RichText bindings", () => {
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
        content: [{ type: "RichText", props: { text: binding("f_bio") } }],
        root: { props: {} },
      },
      item,
    );
    expect(html).toContain("<p>Hello world.</p>");
  });

  it("renders nothing if the field is missing", () => {
    const html = render({
      content: [{ type: "RichText", props: { text: binding("f_missing") } }],
      root: { props: {} },
    });
    expect(html).toBe(render(EMPTY_TEMPLATE));
  });

  it("renders nothing if the bound field holds an empty string", () => {
    const item: Item = {
      ...parisItem(),
      values: { ...parisItem().values, f_bio: { type: "longText", value: "" } },
    };
    const html = render(
      { content: [{ type: "RichText", props: { text: binding("f_bio") } }], root: { props: {} } },
      item,
    );
    expect(html).toBe(render(EMPTY_TEMPLATE));
  });
});

// ---------------------------------------------------------------------------
// One library for pages and templates (#349)
// ---------------------------------------------------------------------------

describe("resolveTemplate — page bodies", () => {
  it("passes plain literal props through by identity", () => {
    const button = {
      type: "Button",
      props: { id: "b1", text: "Listen", href: "/music", variant: "primary", isExternal: false },
    };
    const tpl = { content: [button], root: { props: {} } } as Template;
    const resolved = resolveTemplate(tpl, parisItem());
    expect(resolved.content[0]).toBe(button);
  });

  it("never hides a block for a plain empty literal (only a failed binding hides)", () => {
    const tpl = {
      content: [{ type: "Button", props: { text: "", href: "#" } }],
      root: { props: {} },
    } as Template;
    expect(resolveTemplate(tpl, parisItem()).content).toHaveLength(1);
  });

  it("binds a longText field into a RichText block as paragraphs", () => {
    const item: Item = {
      ...parisItem(),
      values: { ...parisItem().values, f_notes: { type: "longText", value: "One\n\nTwo" } },
    };
    const html = render(
      { content: [{ type: "RichText", props: { text: binding("f_notes") } }], root: { props: {} } },
      item,
    );
    expect(html).toContain("<p>One</p><p>Two</p>");
  });
});

describe("resolveTemplate — Collection blocks need collectionSlugs", () => {
  // ADR §4.3 cycle safety: an item template's walk passes no slugs, so a
  // Collection block in it never resolves (and never iterates items whose
  // templates could embed it again).
  it("leaves a Collection block unresolved without collectionSlugs", () => {
    const tpl = {
      content: [{ type: "TourDatesView", props: { sourceCollection: "tour-dates" } }],
      root: { props: {} },
    } as Template;
    const resolved = resolveTemplate(tpl, parisItem(), {
      loadedCollections: { "tour-dates": { def: tourDatesDef(), items: [parisItem()] } },
    });
    expect((resolved.content[0] as { props: { items?: unknown } }).props.items).toBeUndefined();
  });
});
