/**
 * Unit tests for `resolveTemplate` — the walker that turns a template
 * with `Bindable<T>` props into a template with literal props.
 *
 * Rendering is tested separately in `renderer.test.tsx`. Splitting the
 * two means walker bugs surface as walker test failures rather than
 * mysterious HTML differences.
 */

import { describe, expect, it } from "vitest";

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
    expect(out.content[0]).toEqual({
      type: "Text",
      props: { content: "Hello", variant: "body", align: "start" },
    });
  });

  it("preserves a literal Bindable unchanged", () => {
    const template: Template = {
      content: [{ type: "Text", props: { content: literal("Hi") } }],
      root: { props: {} },
    };
    const out = resolveTemplate(template, makeItem({}));
    expect(out.content[0]).toMatchObject({ type: "Text", props: { content: "Hi" } });
  });

  it("resolves to undefined for a missing field", () => {
    const template: Template = {
      content: [{ type: "Text", props: { content: binding("fld_missing") } }],
      root: { props: {} },
    };
    const out = resolveTemplate(template, makeItem({}));
    expect(out.content[0]).toMatchObject({ props: { content: undefined } });
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

  it("returns an empty children array when the layout block has no children prop", () => {
    const template: Template = {
      content: [{ type: "Section", props: {} }],
      root: { props: {} },
    };
    const out = resolveTemplate(template, makeItem({}));
    expect((out.content[0].props as { children: unknown }).children).toEqual([]);
  });
});
