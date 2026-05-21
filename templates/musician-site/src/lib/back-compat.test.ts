/**
 * Backwards-compatibility sanity tests.
 *
 * The Puck block schema for `Heading`, `Section`, and `Button` gained new
 * required props (`textAlign`, `isExternal`) when the editor surface was
 * expanded. Pages saved before that change won't have those fields. Puck
 * fills in `defaultProps` for missing keys at render time, so old pages
 * keep parsing — these tests pin that behaviour down so it doesn't
 * silently regress.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { puckConfig } from "@/puck/config";
import { extractPageRootProps } from "@/lib/content";

function renderBlock(name: keyof typeof puckConfig.components, props: unknown): string {
  const component = puckConfig.components[name];
  const renderFn = component.render as (p: unknown) => React.ReactElement;
  // Mimic what <Render> does at runtime — merge defaults into the passed
  // props so missing fields fall back. This matches Puck's actual behaviour.
  const merged = { ...component.defaultProps, ...(props as Record<string, unknown>) };
  return renderToStaticMarkup(createElement(() => renderFn(merged)));
}

describe("Heading back-compat", () => {
  it("renders an old payload that has no textAlign", () => {
    const html = renderBlock("Heading", { text: "Welcome", level: "h1" });
    expect(html).toContain("Welcome");
    expect(html).toContain("<h1");
  });
});

describe("Section back-compat", () => {
  it("renders an old payload that has no textAlign and no children", () => {
    // Section moved from textarea body to a slot of nested blocks. Old
    // payloads (pre-slot) shipped `headline` + `body` strings — those
    // fields are now ignored, but the block must keep rendering
    // (artists will re-author the content; we don't want a crash on
    // first paint). Stub `children` to match what Puck's `<Render>`
    // would hand the block at runtime.
    const html = renderBlock("Section", {
      width: "md",
      children: () => null,
    });
    expect(html).toContain("<section");
    expect(html).toMatch(/max-width:\s*var\(--max-width-content\)/);
  });
});

describe("Button back-compat", () => {
  it("renders an old payload that has no isExternal", () => {
    const html = renderBlock("Button", {
      text: "Buy",
      href: "/tickets",
      variant: "primary",
    });
    expect(html).toContain("Buy");
    expect(html).toContain('href="/tickets"');
    // Default isExternal=false → no _blank.
    expect(html).not.toContain("_blank");
  });
});

describe("page root props back-compat", () => {
  it("extractPageRootProps fills defaults for legacy pages with only title", () => {
    const props = extractPageRootProps({
      content: [],
      root: { props: { title: "Old page" } },
    } as Parameters<typeof extractPageRootProps>[0]);
    expect(props).toEqual({
      title: "Old page",
      isSplashPage: false,
      isFooterHidden: false,
    });
  });

  it("falls back to 'Untitled' when even title is missing (very old payload)", () => {
    const props = extractPageRootProps({
      content: [],
      root: {},
    } as Parameters<typeof extractPageRootProps>[0]);
    expect(props.title).toBe("Untitled");
  });
});
