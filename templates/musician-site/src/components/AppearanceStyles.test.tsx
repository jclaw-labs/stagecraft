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
});
