import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Header } from "./Header";
import { DEFAULT_HEADER_CONFIG } from "@/lib/site-config-types";

function renderHeader(
  override: Partial<Parameters<typeof Header>[0]> = {},
): string {
  return renderToStaticMarkup(
    <Header
      artistName="Sarah Chen"
      header={DEFAULT_HEADER_CONFIG}
      navItems={["home", "about"]}
      pageTitleBySlug={new Map([["home", "Home"], ["about", "About"]])}
      {...override}
    />,
  );
}

describe("<Header>", () => {
  it("renders the artist name as the brand when no wordmark is set", () => {
    const html = renderHeader();
    expect(html).toContain("Sarah Chen");
  });

  it("renders the page title for each nav slug, not the slug", () => {
    const html = renderHeader({ navItems: ["home", "about"] });
    expect(html).toContain(">Home<");
    expect(html).toContain(">About<");
  });

  it("logo-center-nav-split renders a 3-column grid with two nav halves", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerLayout: "logo-center-nav-split" },
      navItems: ["home", "music", "about", "contact"],
      pageTitleBySlug: new Map([
        ["home", "Home"],
        ["music", "Music"],
        ["about", "About"],
        ["contact", "Contact"],
      ]),
    });
    // Real split (not the old nav-below no-op): a 3-col grid + two <nav>s.
    expect(html).toMatch(/grid-template-columns:\s*1fr auto 1fr/);
    expect((html.match(/<nav/g) ?? []).length).toBe(2);
    // Brand sits between the two halves.
    expect(html).toContain("Sarah Chen");
  });

  it("falls back to the slug when the page title isn't known", () => {
    const html = renderHeader({
      navItems: ["mystery"],
      pageTitleBySlug: new Map(),
    });
    expect(html).toContain(">mystery<");
  });

  it("uses sticky positioning in solid-sticky mode", () => {
    const html = renderHeader();
    expect(html).toMatch(/position:\s*sticky/);
  });

  it("stays in normal flow (relative, not absolute) in solid-static mode", () => {
    // Non-sticky headers reserve their height instead of overlaying the
    // page, so they never collide with or hide the top of the content.
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerMode: "solid-static" },
    });
    expect(html).toMatch(/position:\s*relative/);
    expect(html).not.toMatch(/position:\s*absolute/);
  });

  it("removes the background in transparent-static mode", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerMode: "transparent-static" },
    });
    expect(html).toMatch(/background:\s*transparent/);
  });

  it("applies the foreground color when transparent + color is set", () => {
    const html = renderHeader({
      header: {
        ...DEFAULT_HEADER_CONFIG,
        headerMode: "transparent-static",
        headerForegroundColor: "#ffeeaa",
      },
    });
    expect(html).toContain("color:#ffeeaa");
  });

  it("glass mode is sticky with a backdrop blur and translucent surface", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerMode: "glass-sticky" },
    });
    expect(html).toMatch(/position:\s*sticky/);
    expect(html).toMatch(/backdrop-filter:\s*blur/);
    expect(html).toMatch(/color-mix/);
  });

  it("bold header border renders a 3px rule", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerBorder: "bold" },
    });
    expect(html).toMatch(/border-bottom:\s*3px solid/);
  });

  it("accent header border uses the accent color", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerBorder: "accent" },
    });
    expect(html).toMatch(/border-bottom:\s*2px solid var\(--color-accent\)/);
  });

  it("none header border removes the rule", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerBorder: "none" },
    });
    expect(html).toMatch(/border-bottom:\s*none/);
  });

  it("compact header height tightens the padding", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerHeight: "compact" },
    });
    expect(html).toContain("var(--space-3) var(--space-4)");
  });

  it("uppercase header text adds text-transform: uppercase", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, isHeaderTextUppercase: true },
    });
    expect(html).toMatch(/text-transform:\s*uppercase/);
  });

  it("renders headerSubtitle when set", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerSubtitle: "Bandleader / Pianist" },
    });
    expect(html).toContain("Bandleader / Pianist");
  });
});
