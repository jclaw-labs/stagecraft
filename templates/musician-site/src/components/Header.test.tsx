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

  it("becomes absolute (not sticky) in solid-static mode", () => {
    const html = renderHeader({
      header: { ...DEFAULT_HEADER_CONFIG, headerMode: "solid-static" },
    });
    expect(html).toMatch(/position:\s*absolute/);
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
