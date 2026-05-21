import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DrawerItemPreview } from "./DrawerItemPreview";

/**
 * The override's contract: for any drawer item, render Puck's default
 * label + drag affordance (the `children`) below a preview box that
 * either live-renders the block's defaultProps or falls back to a
 * static name pill. These tests lock the fallback policy — see the
 * comment at the top of `DrawerItemPreview.tsx` for the rationale.
 */

function render(name: string) {
  return renderToStaticMarkup(
    <DrawerItemPreview name={name}>
      <span data-testid="puck-child">child</span>
    </DrawerItemPreview>,
  );
}

describe("<DrawerItemPreview>", () => {
  it("always renders Puck's children (label + drag affordance)", () => {
    expect(render("Heading")).toContain("puck-child");
    expect(render("Embed")).toContain("puck-child");
    expect(render("DoesNotExist")).toContain("puck-child");
  });

  it("falls back to a static name pill for Embed (its render does iframe I/O)", () => {
    const html = render("Embed");
    // Static pill shows the block name verbatim.
    expect(html).toContain(">Embed<");
    // Live render would have emitted the iframe from defaultProps.
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("open.spotify.com");
  });

  it("falls back to a static name pill for unregistered block names", () => {
    const html = render("DoesNotExist");
    expect(html).toContain(">DoesNotExist<");
  });

  it("live-renders a pure block (Heading) from its defaultProps", () => {
    const html = render("Heading");
    // Heading's defaultProps: { text: "Heading", level: "h2", textAlign: "start" }
    expect(html).toContain("<h2");
    expect(html).toContain(">Heading</h2>");
  });

  it("live-renders Section from its defaultProps", () => {
    const html = render("Section");
    // Section's defaults: headline "Section title", body "Section body".
    expect(html).toContain("Section title");
    expect(html).toContain("Section body");
  });
});
