import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ThemeThumbnail } from "./ThemeThumbnail";
import { THEME_PRESETS } from "@/lib/theme-presets";

describe("<ThemeThumbnail>", () => {
  it("renders the preset palette in a sample layout", () => {
    const preset = THEME_PRESETS.meadow;
    const html = renderToStaticMarkup(<ThemeThumbnail preset={preset} />);
    // Sample copy + button label.
    expect(html).toContain("Aa");
    expect(html).toContain("Listen");
    // The preset's own colours are applied inline (data being previewed).
    expect(html).toContain(preset.appearance.colors.background);
    expect(html).toContain(preset.appearance.colors.accent);
  });

  it("conveys typographic character via the family's CSS generic fallback", () => {
    // ink ships a serif body (Lora) → the stack must carry the serif generic
    // so the preview reads as serif even though the webfont isn't loaded.
    const html = renderToStaticMarkup(<ThemeThumbnail preset={THEME_PRESETS.ink} />);
    // buildFontStack appends a CSS generic, e.g. "'Lora', serif" → ", serif".
    expect(html).toMatch(/,\s(serif|sans-serif|monospace|cursive)/);
  });

  it("renders for every preset without throwing", () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(() => renderToStaticMarkup(<ThemeThumbnail preset={preset} />)).not.toThrow();
    }
  });
});
