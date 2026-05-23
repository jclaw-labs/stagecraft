import { describe, expect, it } from "vitest";

import {
  appearanceSchema,
  DEFAULT_APPEARANCE,
  DEFAULT_HEADER_CONFIG,
  headerConfigSchema,
  type HeaderConfig,
} from "./site-config-types";
import {
  DEFAULT_THEME_ID,
  resolveTheme,
  THEME_IDS,
  THEME_PRESETS,
} from "./theme-presets";

describe("theme presets", () => {
  it("has exactly one preset per declared id (no drift)", () => {
    expect(Object.keys(THEME_PRESETS).sort()).toEqual([...THEME_IDS].sort());
  });

  it("DEFAULT_THEME_ID is a known theme", () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME_ID);
  });

  it("classic mirrors the platform default appearance", () => {
    expect(THEME_PRESETS.classic.appearance).toEqual(DEFAULT_APPEARANCE);
  });

  for (const id of THEME_IDS) {
    describe(`preset "${id}"`, () => {
      const preset = THEME_PRESETS[id];

      it("has a non-empty name + description", () => {
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      });

      it("appearance validates against the appearance schema", () => {
        expect(() => appearanceSchema.parse(preset.appearance)).not.toThrow();
      });

      it("header style validates against the header schema", () => {
        // Presets carry style fields only; fill the artist-owned fields to
        // validate the merged shape the renderer ultimately consumes.
        expect(() =>
          headerConfigSchema.parse({ ...DEFAULT_HEADER_CONFIG, ...preset.header }),
        ).not.toThrow();
      });

      it("split typography names a heading font", () => {
        if (preset.appearance.typography.headingMode === "split") {
          expect(preset.appearance.typography.headingFont.length).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe("resolveTheme", () => {
  it("replaces appearance with the preset palette", () => {
    const resolved = resolveTheme("midnight", DEFAULT_HEADER_CONFIG);
    expect(resolved.appearance).toEqual(THEME_PRESETS.midnight.appearance);
    expect(resolved.appearance.colors.background).toBe("#0b0b12");
  });

  it("applies the preset's header style fields", () => {
    const resolved = resolveTheme("marquee", DEFAULT_HEADER_CONFIG);
    expect(resolved.header.headerLayout).toBe("logo-center-nav-split");
    expect(resolved.header.isHeaderTextUppercase).toBe(true);
    expect(resolved.header.wordmarkSizeAdjust).toBe(1);
  });

  it("preserves artist-owned header fields (wordmark + subtitle)", () => {
    const wordmark = { id: "x", alt: "logo" } as unknown as HeaderConfig["wordmark"];
    const existing: HeaderConfig = {
      ...DEFAULT_HEADER_CONFIG,
      wordmark,
      headerSubtitle: "Live in 2026",
    };
    const resolved = resolveTheme("marquee", existing);
    expect(resolved.header.wordmark).toBe(wordmark);
    expect(resolved.header.headerSubtitle).toBe("Live in 2026");
  });

  it("returns a fresh appearance copy (no shared-constant mutation)", () => {
    const resolved = resolveTheme("classic", DEFAULT_HEADER_CONFIG);
    resolved.appearance.colors.primary = "#changed";
    expect(THEME_PRESETS.classic.appearance.colors.primary).not.toBe("#changed");
    expect(DEFAULT_APPEARANCE.colors.primary).not.toBe("#changed");
  });
});
