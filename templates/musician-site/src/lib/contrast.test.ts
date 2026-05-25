import { describe, expect, it } from "vitest";

import {
  checkAppearanceContrast,
  contrastRatio,
  parseHex,
  relativeLuminance,
  WCAG_AA_NORMAL,
} from "./contrast";

describe("parseHex", () => {
  it("parses #rrggbb and #rgb", () => {
    expect(parseHex("#ffffff")).toEqual([255, 255, 255]);
    expect(parseHex("#000000")).toEqual([0, 0, 0]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("ABCDEF")).toEqual([171, 205, 239]);
  });

  it("returns null for non-hex", () => {
    expect(parseHex("")).toBeNull();
    expect(parseHex("rgb(0,0,0)")).toBeNull();
    expect(parseHex("var(--x)")).toBeNull();
    expect(parseHex("#12")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and ~1 for white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
  it("returns null for non-hex", () => {
    expect(relativeLuminance("nope")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for identical colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#3a3a3a", "#3a3a3a")).toBeCloseTo(1, 5);
  });
  it("is symmetric", () => {
    const a = contrastRatio("#112233", "#ddeeff");
    const b = contrastRatio("#ddeeff", "#112233");
    expect(a).toBeCloseTo(b as number, 10);
  });
  it("returns null when a color isn't hex", () => {
    expect(contrastRatio("#000", "transparent")).toBeNull();
  });
});

describe("checkAppearanceContrast", () => {
  const goodColors = {
    background: "#ffffff",
    surface: "#ffffff",
    text: "#111111",
    textMuted: "#555555",
    accent: "#0b3d91",
    linkColor: "",
  };

  it("flags a low-contrast pair (light grey text on white) as failing AA", () => {
    const results = checkAppearanceContrast(
      { ...goodColors, text: "#cccccc" },
      "#ffffff",
      "solid",
    );
    const bodyOnBg = results.find((r) => r.label === "Body text on background");
    expect(bodyOnBg?.passesAA).toBe(false);
    expect(bodyOnBg!.ratio).toBeLessThan(WCAG_AA_NORMAL);
  });

  it("passes a high-contrast palette", () => {
    const results = checkAppearanceContrast(goodColors, "#ffffff", "solid");
    expect(results.every((r) => r.passesAA)).toBe(true);
  });

  it("solid button: checks the on-accent label against the accent fill (surface fallback)", () => {
    // White-ish surface label on a white accent → unreadable → must fail.
    const results = checkAppearanceContrast({ ...goodColors, accent: "#fafafa" }, "", "solid");
    const button = results.find((r) => r.label === "Button label on accent");
    expect(button?.passesAA).toBe(false);
  });

  it("outline button: checks the accent label against the page background instead", () => {
    // A light accent on a white background is unreadable for an outline button,
    // even though a solid button (with a dark on-accent label) would pass.
    const colors = { ...goodColors, accent: "#f2f2f2" };
    const outline = checkAppearanceContrast(colors, "#111111", "outline");
    const solid = checkAppearanceContrast(colors, "#111111", "solid");
    expect(outline.find((r) => r.label === "Button label")?.passesAA).toBe(false);
    // Solid checks dark-onAccent (#111) vs the light accent → passes.
    expect(solid.find((r) => r.label === "Button label on accent")?.passesAA).toBe(true);
  });

  it("skips pairs whose color isn't a hex value", () => {
    const results = checkAppearanceContrast({ ...goodColors, text: "" }, "#ffffff", "solid");
    expect(results.find((r) => r.label === "Body text on background")).toBeUndefined();
    // Other measurable pairs still evaluated.
    expect(results.length).toBeGreaterThan(0);
  });
});
