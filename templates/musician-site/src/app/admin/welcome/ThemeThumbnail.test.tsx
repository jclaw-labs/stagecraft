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

  it("conveys serif-vs-sans character via the CSS generic fallback", () => {
    // meadow's heading is Fraunces (a curated serif) → "'Fraunces', serif".
    // The webfont isn't loaded in the wizard, so the serif generic is what
    // actually telegraphs the character. ", serif" is NOT a substring of
    // ", sans-serif", so this distinguishes serif from sans themes.
    const serifHtml = renderToStaticMarkup(<ThemeThumbnail preset={THEME_PRESETS.meadow} />);
    expect(serifHtml).toMatch(/,\sserif/);
    // concrete is wholly sans (Archivo) → no standalone serif generic.
    const sansHtml = renderToStaticMarkup(<ThemeThumbnail preset={THEME_PRESETS.concrete} />);
    expect(sansHtml).not.toMatch(/,\sserif/);
  });

  it("renders for every preset without throwing", () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(() => renderToStaticMarkup(<ThemeThumbnail preset={preset} />)).not.toThrow();
    }
  });
});
