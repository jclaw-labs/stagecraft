import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AppearanceStyles } from "./AppearanceStyles";
import { DEFAULT_APPEARANCE } from "@/lib/site-config-types";

function render(override: Partial<typeof DEFAULT_APPEARANCE> = {}) {
  const appearance = { ...DEFAULT_APPEARANCE, ...override };
  return renderToStaticMarkup(<AppearanceStyles appearance={appearance} />);
}

describe("<AppearanceStyles>", () => {
  it("emits CSS custom properties for every color token", () => {
    const html = render();
    expect(html).toContain("--color-primary: #1a1a2e");
    expect(html).toContain("--color-secondary: #b91c4a");
    expect(html).toContain("--color-background: #fafafa");
    expect(html).toContain("--color-text: #1a1a2e");
  });

  it("emits font family CSS variables for body + headings", () => {
    const html = render({
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        bodyFont: "Inter",
        headingMode: "split",
        headingFont: "Merriweather",
      },
    });
    expect(html).toContain("--font-body: 'Inter'");
    expect(html).toContain("--font-headings: 'Merriweather'");
  });

  it("single-font mode uses the body font for headings too", () => {
    const html = render();
    expect(html).toContain("--font-headings: 'Inter'");
  });

  it("ends the stack with the family's category generic (serif body → serif, not sans)", () => {
    const html = render({
      typography: { ...DEFAULT_APPEARANCE.typography, bodyFont: "Merriweather" },
    });
    expect(html).toContain("--font-body: 'Merriweather', system-ui, serif");
  });

  it("keeps a sans-serif tail (with system-ui) for a sans family", () => {
    const html = render(); // default Inter (sans)
    expect(html).toContain("--font-body: 'Inter', system-ui, sans-serif");
  });

  it("falls back to accent for the link color when linkColor is blank", () => {
    const html = render({
      colors: { ...DEFAULT_APPEARANCE.colors, linkColor: "" },
    });
    expect(html).toContain("--color-link: #0f3460"); // matches DEFAULT accent
  });

  it("uses an explicit linkColor when set", () => {
    const html = render({
      colors: { ...DEFAULT_APPEARANCE.colors, linkColor: "#abcdef" },
    });
    expect(html).toContain("--color-link: #abcdef");
  });

  it("emits a Google Fonts <link> with the requested family + weights", () => {
    const html = render({
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        bodyFont: "Inter",
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 900, h2: 700, h3: 700 },
      },
    });
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?family=Inter:wght@400;700;900/);
  });

  it("requests both families with their own weight unions in split mode", () => {
    const html = render({
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        bodyFont: "Inter",
        headingMode: "split",
        headingFont: "Merriweather",
      },
    });
    expect(html).toMatch(/family=Inter:wght@400;700/);
    expect(html).toMatch(/family=Merriweather:wght@700/);
  });

  it("emits the design tokens at their defaults", () => {
    const html = render();
    expect(html).toContain("--radius-theme: 0.5rem"); // soft
    expect(html).toContain("--content-measure: 52rem"); // medium
    expect(html).toContain("--space-scale: 1"); // comfortable
    expect(html).toContain("--btn-radius: 0.5rem"); // rounded
    expect(html).toContain("--rule-width: 1px"); // hairline
    expect(html).toContain("--heading-transform: none");
  });

  it("renders a gradient accent in gradient mode", () => {
    const html = render({
      design: {
        ...DEFAULT_APPEARANCE.design!,
        accentMode: "gradient",
        accentGradient: { from: "#ff0000", via: "#00ff00", to: "#0000ff" },
      },
    });
    expect(html).toContain("--gradient-accent: linear-gradient(120deg, #ff0000, #00ff00, #0000ff)");
  });

  it("loads a 3rd family + sets --font-display when displayFont is set", () => {
    const html = render({
      typography: { ...DEFAULT_APPEARANCE.typography, displayFont: "Anton" },
    });
    expect(html).toContain("--font-display: 'Anton'");
    expect(html).toMatch(/family=Anton:wght@/);
  });

  it("inverse footer swaps background and text", () => {
    const html = render({
      design: { ...DEFAULT_APPEARANCE.design!, footerStyle: "inverse" },
    });
    expect(html).toContain("--footer-bg: #1a1a2e"); // text color
    expect(html).toContain("--footer-text: #fafafa"); // background color
  });

  describe("galleryLayout", () => {
    it("emits no gallery override for the grid default (globals.css owns grid)", () => {
      const html = render({
        design: { ...DEFAULT_APPEARANCE.design!, galleryLayout: "grid" },
      });
      expect(html).not.toContain("[data-gallery");
    });

    it("emits a portrait tile aspect-ratio override scoped to the site", () => {
      const html = render({
        design: { ...DEFAULT_APPEARANCE.design!, galleryLayout: "portrait" },
      });
      expect(html).toMatch(
        /\.stagecraft-site \[data-gallery-item\] \{ aspect-ratio: 3 \/ 4; \}/,
      );
    });

    it("emits a multi-column masonry override scoped to the site", () => {
      const html = render({
        design: { ...DEFAULT_APPEARANCE.design!, galleryLayout: "masonry" },
      });
      expect(html).toMatch(/\.stagecraft-site \[data-gallery\] \{[^}]*columns: 200px/);
      expect(html).toMatch(/break-inside: avoid/);
    });
  });
});
