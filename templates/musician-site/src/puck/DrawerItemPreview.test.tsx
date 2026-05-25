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

function renderPreview(name: string) {
  return renderToStaticMarkup(
    <DrawerItemPreview name={name}>
      <span data-testid="puck-child">child</span>
    </DrawerItemPreview>,
  );
}

describe("<DrawerItemPreview>", () => {
  it("always renders Puck's children (label + drag affordance)", () => {
    expect(renderPreview("Heading")).toContain("puck-child");
    expect(renderPreview("Embed")).toContain("puck-child");
    expect(renderPreview("DoesNotExist")).toContain("puck-child");
  });

  it("falls back to a static name pill for Embed (its render does iframe I/O)", () => {
    const html = renderPreview("Embed");
    // Static pill shows the block name verbatim.
    expect(html).toContain(">Embed<");
    // Live render would have emitted the iframe from defaultProps.
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("open.spotify.com");
  });

  it("falls back to a static pill for blocks whose live render is uninformative", () => {
    // FullscreenSection scaled in a 5rem box is empty hero space;
    // Spacer's render is empty by design; Divider's 1px <hr> vanishes
    // at thumbnail scale. Verified visually before adding here.
    // Gallery's defaultProps are empty tiles (decorative gradient blocks);
    // TourDatesView renders an editor placeholder (items only resolve on the
    // published page) — both are clearer as a name pill.
    for (const name of ["FullscreenSection", "Spacer", "Divider", "Gallery", "TourDatesView", "ReleasesView", "PostsView"]) {
      const html = renderPreview(name);
      expect(html).toContain(`>${name}<`);
    }
  });

  it("falls back to a static name pill for unregistered block names", () => {
    const html = renderPreview("DoesNotExist");
    expect(html).toContain(">DoesNotExist<");
  });

  it("live-renders a pure block (Heading) from its defaultProps", () => {
    const html = renderPreview("Heading");
    // Heading's defaultProps: { text: "Heading", level: "h2", textAlign: "start" }
    expect(html).toContain("<h2");
    expect(html).toContain(">Heading</h2>");
  });

  it("falls back to a static pill for slot containers (Section, Columns)", () => {
    // Section + Columns have `children: { type: "slot" }` fields;
    // defaultProps carries the slot as `[]`, and the render does
    // `<Children />` which throws when handed an array. Detecting
    // the slot at config-introspection time avoids the throw.
    const sectionHtml = renderPreview("Section");
    expect(sectionHtml).toContain(">Section<");
    expect(sectionHtml).not.toContain("<section");

    const columnsHtml = renderPreview("Columns");
    expect(columnsHtml).toContain(">Columns<");
    // Live-rendered Columns would emit a grid container.
    expect(columnsHtml).not.toMatch(/display:\s*grid/);
  });

  it("live-renders ContactForm (a hooks-using block) without crashing", () => {
    // ContactForm uses useState; the render-as-component path
    // (`<Component {...defaultProps} />` vs `component.render(defaultProps)`)
    // is what makes this work — calling the render as a plain function
    // would mis-bind hook state to PreviewBox.
    expect(() => renderPreview("ContactForm")).not.toThrow();
    const html = renderPreview("ContactForm");
    expect(html).toContain('name="email"');
  });
});
