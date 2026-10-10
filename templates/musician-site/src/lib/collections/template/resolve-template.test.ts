/**
 * Unit tests for `resolveTemplate` — the walker that turns a template
 * with `Bindable<T>` props into a template with literal props.
 *
 * Rendering is tested separately in `renderer.test.tsx`. Splitting the
 * two means walker bugs surface as walker test failures rather than
 * mysterious HTML differences.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { binding, literal } from "./binding";
import { resolveTemplate } from "./renderer";
import type { Template } from "./types";
import type { Item } from "../schema";
import { FIXTURE_TIMESTAMP } from "../test-fixtures";

function makeItem(values: Item["values"]): Item {
  return {
    id: "item_test",
    slug: "test",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values,
  };
}

describe("resolveTemplate", () => {
  it("resolves a Bindable<string> on a known block", () => {
    const template: Template = {
      content: [{ type: "Text", props: { content: binding("fld_v") } }],
      root: { props: {} },
    };
    const item = makeItem({ fld_v: { type: "text", value: "Hello" } });
    const out = resolveTemplate(template, item);
    // Only the bound prop changes; Puck fills the block's defaultProps for
    // missing keys at render time.
    expect(out.content[0]).toEqual({ type: "Text", props: { content: "Hello" } });
  });

  it("preserves a literal Bindable unchanged", () => {
    const template: Template = {
      content: [{ type: "Text", props: { content: literal("Hi") } }],
      root: { props: {} },
    };
    const out = resolveTemplate(template, makeItem({}));
    expect(out.content[0]).toMatchObject({ type: "Text", props: { content: "Hi" } });
  });

  it("drops a block whose bound field is missing (hide-if-empty)", () => {
    const template: Template = {
      content: [{ type: "Text", props: { content: binding("fld_missing") } }],
      root: { props: {} },
    };
    const out = resolveTemplate(template, makeItem({}));
    expect(out.content).toEqual([]);
  });

  it("recurses into a layout block's children slot", () => {
    const template: Template = {
      content: [
        {
          type: "Section",
          props: {
            children: [
              { type: "Text", props: { content: binding("fld_a") } },
              { type: "Text", props: { content: binding("fld_b") } },
            ],
          },
        },
      ],
      root: { props: {} },
    };
    const item = makeItem({
      fld_a: { type: "text", value: "A" },
      fld_b: { type: "text", value: "B" },
    });
    const out = resolveTemplate(template, item);
    const section = out.content[0];
    const sectionChildren = (section.props as { children: unknown }).children as Array<{
      props: { content: unknown };
    }>;
    expect(sectionChildren[0]).toMatchObject({ props: { content: "A" } });
    expect(sectionChildren[1]).toMatchObject({ props: { content: "B" } });
  });

  it("recurses into deeply nested slots", () => {
    const template: Template = {
      content: [
        {
          type: "Section",
          props: {
            children: [
              {
                type: "Stack",
                props: {
                  direction: "horizontal",
                  children: [{ type: "Text", props: { content: binding("fld_deep") } }],
                },
              },
            ],
          },
        },
      ],
      root: { props: {} },
    };
    const out = resolveTemplate(
      template,
      makeItem({ fld_deep: { type: "text", value: "Deep" } }),
    );
    const inner = (
      (
        (out.content[0].props as { children: Array<{ props: { children: unknown[] } }> }).children
      )[0].props.children as Array<{ props: { content: unknown } }>
    )[0];
    expect(inner.props.content).toBe("Deep");
  });

  it("passes unknown block types through unchanged", () => {
    const template: Template = {
      content: [{ type: "NotARegisteredBlock", props: { foo: "bar" } }],
      root: { props: {} },
    };
    const out = resolveTemplate(template, makeItem({}));
    expect(out.content[0]).toEqual({ type: "NotARegisteredBlock", props: { foo: "bar" } });
  });

  it("preserves Puck-injected id props on blocks", () => {
    // Puck's editor auto-injects `id` on every block. The walker
    // shouldn't strip them — they pass through transparently.
    const template: Template = {
      content: [
        { type: "Text", props: { id: "Text-abc123", content: literal("Hi") } },
      ],
      root: { props: {} },
    };
    const out = resolveTemplate(template, makeItem({}));
    // id isn't in the resolveProps return, but Puck adds it back when
    // rendering. For the walker's purposes, we drop it — we only emit
    // what each block's resolveProps function returns. PR 6 may want
    // to revisit this; for now Puck re-injects ids at render.
    expect(out.content[0].type).toBe("Text");
  });

  it("leaves a layout block with no children prop as it is", () => {
    const template: Template = {
      content: [{ type: "Section", props: {} }],
      root: { props: {} },
    };
    const out = resolveTemplate(template, makeItem({}));
    expect(out.content[0]).toEqual({ type: "Section", props: {} });
  });
});

// Content in the pre-#349 template vocabulary that nobody migrated. The
// walker can't fix it, but it shouldn't vanish without a word either.
describe("resolveTemplate — unmigrated content warnings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // Warnings are deduplicated per message for the life of the module, so
  // each case uses a type name or width no other case uses.
  function warningsFor(content: Template["content"], collectionSlugs?: string[]): string[] {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();
    resolveTemplate({ content, root: { props: {} } }, makeItem({}), { collectionSlugs });
    return warn.mock.calls.map((call) => String(call[0]));
  }

  it("warns on a block type the library doesn't know, and leaves the block in the tree", () => {
    const content = [{ type: "RichTextRender", props: { field: "fld_body" } }];
    const warnings = warningsFor(content);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('unknown block type "RichTextRender"');
    expect(warnings[0]).toContain("migrate-block-library.mjs");
    expect(resolveTemplate({ content, root: { props: {} } }, makeItem({})).content).toEqual(content);
  });

  it("warns on a Section width outside SECTION_WIDTHS, nested or not", () => {
    const warnings = warningsFor([
      {
        type: "Stack",
        props: { children: [{ type: "Section", props: { width: "narrow", children: [] } }] },
      },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Section width "narrow"');
    expect(warnings[0]).toContain("sm / md / lg / full");
  });

  it("warns once per message, however many blocks repeat it", () => {
    const section = { type: "Section", props: { width: "wide", children: [] } };
    expect(warningsFor([section, section, section])).toHaveLength(1);
    expect(warningsFor([section])).toEqual([]);
  });

  it("stays quiet on library blocks, valid widths and a Section with no width", () => {
    expect(
      warningsFor([
        { type: "Section", props: { width: "md", children: [{ type: "Text", props: {} }] } },
        { type: "Section", props: { children: [] } },
        { type: "Button", props: { text: "Tickets", href: "/t" } },
      ]),
    ).toEqual([]);
  });

  it("doesn't read a declared array field's rows as blocks", () => {
    // NewsletterSignup's extra form fields carry a `type` of their own.
    // `"url"` isn't used as a block type elsewhere in this file, so the
    // once-per-message dedupe can't hide a warning here.
    const additionalFields = [{ label: "Website", name: "WEBSITE", type: "url" }];
    expect(warningsFor([{ type: "NewsletterSignup", props: { additionalFields } }])).toEqual([]);
  });

  it("treats an allowed Collection block as known and a disallowed one as unknown", () => {
    const block = { type: "TourDatesView", props: { sourceCollection: "tour-dates" } };
    expect(warningsFor([block], ["tour-dates"])).toEqual([]);
    const warnings = warningsFor([block]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('unknown block type "TourDatesView"');
  });

  it("doesn't warn in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(warningsFor([{ type: "OldPrimitive", props: {} }])).toEqual([]);
  });
});
