import { describe, it, expect } from "vitest";

import {
  appearanceFontFamilies,
  appearanceSchema,
  COLOR_FIELDS,
  createPageRequestSchema,
  DEFAULT_APPEARANCE,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_SITE_CONFIG,
  HEADER_LAYOUTS,
  HEADER_MODES,
  headerConfigSchema,
  isStickyHeader,
  isTransparentHeader,
  PAGE_SLUG_PATTERN,
  pageRootPropsSchema,
  reorderPagesBefore,
  resolveLinkColor,
  siteConfigSchema,
  slugifyTitle,
  SOCIAL_PLATFORMS,
} from "./site-config-types";

describe("siteConfigSchema", () => {
  it("parses the default config", () => {
    const out = siteConfigSchema.parse(DEFAULT_SITE_CONFIG);
    expect(out.artistName).toBe("Artist Name");
    expect(out.contactEmail).toBe("contact@example.com");
    expect(out.isFooterHidden).toBe(false);
    // All 9 social platforms are present with empty strings.
    for (const p of SOCIAL_PLATFORMS) {
      expect(out.socialLinks[p]).toBe("");
    }
  });

  it("rejects empty artistName", () => {
    expect(() =>
      siteConfigSchema.parse({ ...DEFAULT_SITE_CONFIG, artistName: "" }),
    ).toThrow();
  });

  it("rejects malformed contactEmail", () => {
    expect(() =>
      siteConfigSchema.parse({ ...DEFAULT_SITE_CONFIG, contactEmail: "not-an-email" }),
    ).toThrow();
  });

  it("fills missing optional fields with defaults", () => {
    const out = siteConfigSchema.parse({
      artistName: "Sarah",
      siteTitle: "Sarah's Site",
      contactEmail: "sarah@example.com",
    });
    expect(out.siteDescription).toBe("");
    expect(out.copyrightName).toBe("");
    expect(out.isFooterHidden).toBe(false);
    // Default socialLinks block populated from the platform list.
    expect(Object.keys(out.socialLinks).sort()).toEqual([...SOCIAL_PLATFORMS].sort());
  });

  it("defaults pageOrder + hiddenFromNav to empty arrays", () => {
    const out = siteConfigSchema.parse({
      artistName: "Sarah",
      siteTitle: "Sarah's Site",
      contactEmail: "sarah@example.com",
    });
    expect(out.pageOrder).toEqual([]);
    expect(out.hiddenFromNav).toEqual([]);
  });

  it("round-trips pageOrder + hiddenFromNav", () => {
    const out = siteConfigSchema.parse({
      ...DEFAULT_SITE_CONFIG,
      pageOrder: ["home", "about", "tour"],
      hiddenFromNav: ["about"],
    });
    expect(out.pageOrder).toEqual(["home", "about", "tour"]);
    expect(out.hiddenFromNav).toEqual(["about"]);
  });
});

describe("reorderPagesBefore", () => {
  const pages = [
    { slug: "a" },
    { slug: "b" },
    { slug: "c" },
    { slug: "d" },
  ];

  it("moves an earlier item to a later position (drag down)", () => {
    const out = reorderPagesBefore(pages, "a", "c");
    expect(out.map((p) => p.slug)).toEqual(["b", "a", "c", "d"]);
  });

  it("moves a later item to an earlier position (drag up)", () => {
    const out = reorderPagesBefore(pages, "d", "b");
    expect(out.map((p) => p.slug)).toEqual(["a", "d", "b", "c"]);
  });

  it("moving an item before itself is a copy no-op", () => {
    const out = reorderPagesBefore(pages, "b", "b");
    expect(out.map((p) => p.slug)).toEqual(["a", "b", "c", "d"]);
    // Returns a fresh array so React state updates don't see a stale ref.
    expect(out).not.toBe(pages);
  });

  it("returns a copy unchanged when dragged slug is missing", () => {
    const out = reorderPagesBefore(pages, "missing", "a");
    expect(out.map((p) => p.slug)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns a copy unchanged when target slug is missing", () => {
    const out = reorderPagesBefore(pages, "a", "missing");
    expect(out.map((p) => p.slug)).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves the full row object (title, flags, etc.)", () => {
    const richPages = [
      { slug: "a", title: "Alpha", isHidden: false },
      { slug: "b", title: "Bravo", isHidden: true },
    ];
    const out = reorderPagesBefore(richPages, "b", "a");
    expect(out[0]).toEqual({ slug: "b", title: "Bravo", isHidden: true });
  });
});

describe("headerConfigSchema", () => {
  it("parses the default config", () => {
    const out = headerConfigSchema.parse(DEFAULT_HEADER_CONFIG);
    expect(out.headerMode).toBe("solid-sticky");
    expect(out.headerLayout).toBe("logo-left-nav-right");
    expect(out.wordmark).toBeNull();
  });

  it("silently drops a legacy `items` field — nav order moved to siteConfig", () => {
    const out = headerConfigSchema.parse({
      ...DEFAULT_HEADER_CONFIG,
      items: ["home", "about"],
    });
    expect("items" in out).toBe(false);
  });

  it("rejects an unknown headerMode", () => {
    expect(() =>
      headerConfigSchema.parse({ ...DEFAULT_HEADER_CONFIG, headerMode: "rainbow" }),
    ).toThrow();
  });

  it("coerces wordmarkSizeAdjust string to a number", () => {
    const out = headerConfigSchema.parse({
      ...DEFAULT_HEADER_CONFIG,
      wordmarkSizeAdjust: "2",
    });
    expect(out.wordmarkSizeAdjust).toBe(2);
  });

  it("rejects wordmarkSizeAdjust outside [-2, 2]", () => {
    expect(() =>
      headerConfigSchema.parse({
        ...DEFAULT_HEADER_CONFIG,
        wordmarkSizeAdjust: 5,
      }),
    ).toThrow();
  });
});

describe("isTransparentHeader / isStickyHeader", () => {
  it("identifies the transparent-static variant", () => {
    expect(isTransparentHeader("transparent-static")).toBe(true);
    expect(isTransparentHeader("solid-sticky")).toBe(false);
    expect(isTransparentHeader("solid-static")).toBe(false);
  });

  it("identifies the sticky variant", () => {
    expect(isStickyHeader("solid-sticky")).toBe(true);
    expect(isStickyHeader("solid-static")).toBe(false);
    expect(isStickyHeader("transparent-static")).toBe(false);
  });
});

describe("appearanceSchema", () => {
  it("parses the default appearance", () => {
    const out = appearanceSchema.parse(DEFAULT_APPEARANCE);
    expect(out.colors.primary).toBe("#1a1a2e");
    expect(out.typography.bodyFont).toBe("Inter");
    expect(out.typography.headingMode).toBe("single");
  });

  it("rejects an empty primary color", () => {
    expect(() =>
      appearanceSchema.parse({
        ...DEFAULT_APPEARANCE,
        colors: { ...DEFAULT_APPEARANCE.colors, primary: "" },
      }),
    ).toThrow();
  });

  it("rejects an out-of-range font weight", () => {
    expect(() =>
      appearanceSchema.parse({
        ...DEFAULT_APPEARANCE,
        typography: {
          ...DEFAULT_APPEARANCE.typography,
          bodyWeights: { body: 350, bodyBold: 700 },
        },
      }),
    ).toThrow();
  });
});

describe("resolveLinkColor", () => {
  it("falls back to accent when linkColor is blank", () => {
    expect(
      resolveLinkColor({
        ...DEFAULT_APPEARANCE.colors,
        accent: "#222",
        linkColor: "",
      }),
    ).toBe("#222");
  });

  it("uses linkColor when set", () => {
    expect(
      resolveLinkColor({
        ...DEFAULT_APPEARANCE.colors,
        accent: "#222",
        linkColor: "#abc",
      }),
    ).toBe("#abc");
  });
});

describe("appearanceFontFamilies", () => {
  it("returns one family in single mode", () => {
    const out = appearanceFontFamilies(DEFAULT_APPEARANCE);
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe("Inter");
    // 400 (body) and 700 (bodyBold) + 700 (h1/h2/h3) — deduped to [400, 700].
    expect(out[0].weights).toEqual([400, 700]);
  });

  it("returns two families in split mode with a distinct heading font", () => {
    const out = appearanceFontFamilies({
      ...DEFAULT_APPEARANCE,
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        headingMode: "split",
        headingFont: "Merriweather",
      },
    });
    expect(out.map((f) => f.family)).toEqual(["Inter", "Merriweather"]);
  });

  it("collapses to one family when split mode reuses the body font", () => {
    const out = appearanceFontFamilies({
      ...DEFAULT_APPEARANCE,
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        headingMode: "split",
        headingFont: "Inter",
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe("Inter");
  });

  it("includes all distinct heading weights from the heading family", () => {
    const out = appearanceFontFamilies({
      ...DEFAULT_APPEARANCE,
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        headingMode: "split",
        headingFont: "Merriweather",
        headingWeights: { h1: 900, h2: 700, h3: 400 },
      },
    });
    const heading = out.find((f) => f.family === "Merriweather");
    expect(heading?.weights).toEqual([400, 700, 900]);
  });
});

describe("pageRootPropsSchema", () => {
  it("parses defaults for an empty root", () => {
    const out = pageRootPropsSchema.parse({ title: "Home" });
    expect(out.title).toBe("Home");
    expect(out.isSplashPage).toBe(false);
    expect(out.isFooterHidden).toBe(false);
  });

  it("rejects a blank title", () => {
    expect(() => pageRootPropsSchema.parse({ title: "" })).toThrow();
  });
});

describe("createPageRequestSchema", () => {
  it("accepts well-formed slug + title", () => {
    expect(() =>
      createPageRequestSchema.parse({ slug: "about", title: "About" }),
    ).not.toThrow();
  });

  it("rejects uppercase slugs", () => {
    expect(() =>
      createPageRequestSchema.parse({ slug: "About", title: "About" }),
    ).toThrow();
  });

  it("rejects slugs starting with a hyphen", () => {
    expect(() =>
      createPageRequestSchema.parse({ slug: "-about", title: "About" }),
    ).toThrow();
  });

  it("PAGE_SLUG_PATTERN matches the schema's allowed shape", () => {
    expect(PAGE_SLUG_PATTERN.test("home")).toBe(true);
    expect(PAGE_SLUG_PATTERN.test("about-us")).toBe(true);
    expect(PAGE_SLUG_PATTERN.test("page-1")).toBe(true);
    expect(PAGE_SLUG_PATTERN.test("Home")).toBe(false);
    expect(PAGE_SLUG_PATTERN.test("hello world")).toBe(false);
    expect(PAGE_SLUG_PATTERN.test("")).toBe(false);
  });
});

describe("slugifyTitle", () => {
  it("lowercases + collapses spaces to hyphens", () => {
    expect(slugifyTitle("Hello World")).toBe("hello-world");
  });

  it("strips diacritics", () => {
    expect(slugifyTitle("Café")).toBe("cafe");
  });

  it("drops non-alphanumerics", () => {
    expect(slugifyTitle("Q&A — 2026!")).toBe("q-a-2026");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyTitle("--Hello--")).toBe("hello");
  });

  it("returns empty string for unusable input", () => {
    expect(slugifyTitle("!!!")).toBe("");
    expect(slugifyTitle("")).toBe("");
  });

  it("caps length at 64 characters", () => {
    const slug = slugifyTitle("a".repeat(120));
    expect(slug.length).toBeLessThanOrEqual(64);
  });
});

describe("COLOR_FIELDS", () => {
  it("matches the appearance schema's colors keys", () => {
    const colorsKeys = Object.keys(DEFAULT_APPEARANCE.colors).sort();
    expect([...COLOR_FIELDS].sort()).toEqual(colorsKeys);
  });
});

describe("HEADER_MODES / HEADER_LAYOUTS", () => {
  it("HEADER_MODES is exactly the three known modes", () => {
    expect([...HEADER_MODES]).toEqual(["solid-sticky", "solid-static", "transparent-static"]);
  });

  it("HEADER_LAYOUTS is exactly the three known layouts", () => {
    expect([...HEADER_LAYOUTS]).toEqual([
      "logo-left-nav-right",
      "logo-center-nav-below",
      "logo-center-nav-split",
    ]);
  });
});
