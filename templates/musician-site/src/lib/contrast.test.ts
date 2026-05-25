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
    );
    const bodyOnBg = results.find((r) => r.label === "Body text on background");
    expect(bodyOnBg?.passesAA).toBe(false);
    expect(bodyOnBg!.ratio).toBeLessThan(WCAG_AA_NORMAL);
  });

  it("passes a high-contrast palette", () => {
    const results = checkAppearanceContrast(goodColors, "#ffffff");
    // accent (#0b3d91) on its own button label fg #ffffff is the on-accent pair.
    expect(results.every((r) => r.passesAA)).toBe(true);
  });

  it("falls back to surface for the on-accent pair when onAccent is blank", () => {
    // White-ish surface text on a white accent → unreadable → must fail.
    const results = checkAppearanceContrast(
      { ...goodColors, accent: "#fafafa" },
      "",
    );
    const onAccent = results.find((r) => r.label === "Button label on accent");
    expect(onAccent?.passesAA).toBe(false);
  });

  it("skips pairs whose color isn't a hex value", () => {
    const results = checkAppearanceContrast({ ...goodColors, text: "" }, "#ffffff");
    expect(results.find((r) => r.label === "Body text on background")).toBeUndefined();
    // Other measurable pairs still evaluated.
    expect(results.length).toBeGreaterThan(0);
  });
});
