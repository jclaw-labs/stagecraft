import { describe, expect, it } from "vitest";

import {
  buildFontStack,
  CURATED_FONT_CATEGORIES,
  FONT_CATEGORIES,
  fontCategoryForFamily,
  GOOGLE_FONTS,
  GOOGLE_FONTS_BY_FAMILY,
} from "./google-fonts";

describe("google-fonts curated data", () => {
  it("exposes the six picker categories with custom last", () => {
    expect(FONT_CATEGORIES).toContain("custom");
    expect(CURATED_FONT_CATEGORIES).not.toContain("custom");
    expect(CURATED_FONT_CATEGORIES).toEqual([
      "sans-serif",
      "serif",
      "monospace",
      "display",
      "handwriting",
    ]);
  });

  it("every curated category has a non-empty family list tagged with its generic fallback", () => {
    const expectedGeneric: Record<string, string> = {
      "sans-serif": "sans-serif",
      serif: "serif",
      monospace: "monospace",
      display: "sans-serif",
      handwriting: "cursive",
    };
    for (const category of CURATED_FONT_CATEGORIES) {
      expect(GOOGLE_FONTS[category].length).toBeGreaterThan(0);
      for (const font of GOOGLE_FONTS[category]) {
        expect(font.fallback).toBe(expectedGeneric[category]);
      }
    }
  });

  it("builds a flat family lookup covering every curated family", () => {
    const flatCount = Object.keys(GOOGLE_FONTS_BY_FAMILY).length;
    const listCount = CURATED_FONT_CATEGORIES.reduce((n, c) => n + GOOGLE_FONTS[c].length, 0);
    expect(flatCount).toBe(listCount);
    expect(GOOGLE_FONTS_BY_FAMILY["Inter"]).toEqual({ category: "sans-serif", fallback: "sans-serif" });
  });
});

describe("fontCategoryForFamily", () => {
  it("maps curated families to their category", () => {
    expect(fontCategoryForFamily("Inter")).toBe("sans-serif");
    expect(fontCategoryForFamily("Merriweather")).toBe("serif");
    expect(fontCategoryForFamily("JetBrains Mono")).toBe("monospace");
    expect(fontCategoryForFamily("Bebas Neue")).toBe("display");
    expect(fontCategoryForFamily("Caveat")).toBe("handwriting");
  });

  it("reports custom for an unknown family", () => {
    expect(fontCategoryForFamily("My Bespoke Face")).toBe("custom");
  });
});

describe("buildFontStack", () => {
  it("appends the category-appropriate generic for curated families", () => {
    expect(buildFontStack("Inter")).toBe("'Inter', sans-serif");
    expect(buildFontStack("Merriweather")).toBe("'Merriweather', serif");
    expect(buildFontStack("JetBrains Mono")).toBe("'JetBrains Mono', monospace");
    expect(buildFontStack("Caveat")).toBe("'Caveat', cursive");
  });

  it("falls back to sans-serif for unknown families", () => {
    expect(buildFontStack("My Bespoke Face")).toBe("'My Bespoke Face', sans-serif");
  });

  it("returns an empty string for empty / whitespace input", () => {
    expect(buildFontStack("")).toBe("");
    expect(buildFontStack("   ")).toBe("");
  });
});
