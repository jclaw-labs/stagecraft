/**
 * Pure-function tests for the conversion helpers. The store-layer
 * integration goes through `content.test.ts`; here we just check
 * that each direction is the inverse of the other for representative
 * inputs.
 */

import { describe, expect, it } from "vitest";

import {
  appearanceFromItem,
  appearanceToItemValues,
  headerConfigFromItem,
  headerConfigToItemValues,
  pageDataFromItem,
  pageDataToItem,
  pageDataToItemValues,
  siteConfigFromItem,
  siteConfigToItemValues,
} from "./migrate-from-legacy";
import { PAGES_FIELD_IDS, SITE_FIELD_IDS } from "./seeds";
import { FIXTURE_TIMESTAMP } from "./test-fixtures";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_SITE_CONFIG,
} from "../site-config-types";

describe("pages: data ↔ item round-trip", () => {
  it("preserves title, isSplashPage, isFooterHidden, and content blocks", () => {
    const original = {
      content: [
        { type: "Heading", props: { id: "h1", text: "Hi", level: "h1", textAlign: "center" } },
      ],
      root: {
        props: { title: "About", isSplashPage: false, isFooterHidden: true },
      },
    };
    const item = pageDataToItem("about", original, {
      id: "item_about",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
    });
    const round = pageDataFromItem({ ...item, slug: "about" });
    // round.root is a plain object cast through Puck's Data type;
    // the props are the page's PageRootProps shape.
    const props = (round.root?.props ?? {}) as { title?: string; isFooterHidden?: boolean };
    expect(props.title).toBe("About");
    expect(props.isFooterHidden).toBe(true);
    expect(round.content).toEqual(original.content);
  });

  it("defaults showInNav to true on first migration but accepts override", () => {
    const values = pageDataToItemValues({ content: [], root: { props: { title: "x" } } });
    expect(values[PAGES_FIELD_IDS.showInNav]).toEqual({ type: "boolean", value: true });
    const hidden = pageDataToItemValues(
      { content: [], root: { props: { title: "y" } } },
      { showInNav: false },
    );
    expect(hidden[PAGES_FIELD_IDS.showInNav]).toEqual({ type: "boolean", value: false });
  });

  it("treats missing root.props as defaults (Untitled, not-splash, not-hidden)", () => {
    const values = pageDataToItemValues({ content: [], root: { props: {} } });
    expect(values[PAGES_FIELD_IDS.title]).toEqual({ type: "text", value: "Untitled" });
    expect(values[PAGES_FIELD_IDS.isSplashPage]).toEqual({ type: "boolean", value: false });
    expect(values[PAGES_FIELD_IDS.isFooterHidden]).toEqual({ type: "boolean", value: false });
  });
});

describe("site: config ↔ item round-trip", () => {
  it("preserves the scalar fields", () => {
    const config = {
      ...DEFAULT_SITE_CONFIG,
      artistName: "Test Artist",
      siteTitle: "Test — Site",
      contactEmail: "a@b.com",
      copyrightName: "Test LLC",
      isFooterHidden: true,
    };
    const values = siteConfigToItemValues(config);
    const round = siteConfigFromItem({
      id: "item_site",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values,
    });
    expect(round.artistName).toBe("Test Artist");
    expect(round.siteTitle).toBe("Test — Site");
    expect(round.contactEmail).toBe("a@b.com");
    expect(round.copyrightName).toBe("Test LLC");
    expect(round.isFooterHidden).toBe(true);
  });

  it("omits empty social links from the values (no failing-validation empty URLs)", () => {
    const values = siteConfigToItemValues(DEFAULT_SITE_CONFIG);
    expect(values[SITE_FIELD_IDS.social("instagram")]).toBeUndefined();
  });

  it("round-trips populated social links", () => {
    const config = {
      ...DEFAULT_SITE_CONFIG,
      socialLinks: {
        ...DEFAULT_SITE_CONFIG.socialLinks,
        instagram: "https://instagram.com/x",
        spotify: "https://open.spotify.com/x",
      },
    };
    const round = siteConfigFromItem({
      id: "item_site",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: siteConfigToItemValues(config),
    });
    expect(round.socialLinks.instagram).toBe("https://instagram.com/x");
    expect(round.socialLinks.spotify).toBe("https://open.spotify.com/x");
    expect(round.socialLinks.twitter).toBe(""); // unset → empty in the reconstructed shape
  });

  it("returns DEFAULT_SITE_CONFIG when the item is null", () => {
    expect(siteConfigFromItem(null)).toEqual(DEFAULT_SITE_CONFIG);
  });

  it("round-trips favicon + pageBackground when set, omits the values when null", async () => {
    const { asImageId } = await import("@/lib/image-types");
    const fixtureImage = {
      id: asImageId("abc1234567890def"),
      alt: "Logo",
      width: 256,
      height: 256,
      placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
      contentSlug: "site",
      originalExt: "png" as const,
    };

    // When BOTH set: round-trip through the value map.
    const withImages = siteConfigToItemValues({
      ...DEFAULT_SITE_CONFIG,
      favicon: fixtureImage,
      pageBackground: { ...fixtureImage, alt: "Stage" },
    });
    expect(withImages[SITE_FIELD_IDS.favicon]).toEqual({
      type: "image",
      value: fixtureImage,
    });
    expect(withImages[SITE_FIELD_IDS.pageBackground]).toEqual({
      type: "image",
      value: { ...fixtureImage, alt: "Stage" },
    });

    // When BOTH null: keys absent from the value map (the dynamic
    // item schema's image type isn't nullable; an explicit null
    // would fail validation at write time).
    const empty = siteConfigToItemValues(DEFAULT_SITE_CONFIG);
    expect(empty[SITE_FIELD_IDS.favicon]).toBeUndefined();
    expect(empty[SITE_FIELD_IDS.pageBackground]).toBeUndefined();

    // Full round-trip via fromItem: image values reconstructed.
    const round = siteConfigFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: withImages,
    });
    expect(round.favicon).toEqual(fixtureImage);
    expect(round.pageBackground?.alt).toBe("Stage");

    // From an item without those keys: nulls (matches DEFAULT_SITE_CONFIG).
    const fallback = siteConfigFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: empty,
    });
    expect(fallback.favicon).toBeNull();
    expect(fallback.pageBackground).toBeNull();
  });

  it("drops pageOrder / hiddenFromNav (moved to pages collection)", () => {
    const round = siteConfigFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: siteConfigToItemValues({
        ...DEFAULT_SITE_CONFIG,
        pageOrder: ["a", "b", "c"],
        hiddenFromNav: ["b"],
      }),
    });
    // The pages-derived fields aren't carried by the site singleton —
    // content.ts's readSiteConfig recomputes them from the pages
    // collection. Here the converter alone returns empty arrays.
    expect(round.pageOrder).toEqual([]);
    expect(round.hiddenFromNav).toEqual([]);
  });
});

describe("header: config ↔ item round-trip", () => {
  it("preserves all fields", () => {
    const config = {
      ...DEFAULT_HEADER_CONFIG,
      headerSubtitle: "Singer-songwriter",
      isHeaderTextUppercase: true,
      headerMode: "transparent-static" as const,
    };
    const values = headerConfigToItemValues(config);
    const round = headerConfigFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values,
    });
    expect(round.headerSubtitle).toBe("Singer-songwriter");
    expect(round.isHeaderTextUppercase).toBe(true);
    expect(round.headerMode).toBe("transparent-static");
  });

  it("round-trips headerHeight + headerBorder", () => {
    const config = {
      ...DEFAULT_HEADER_CONFIG,
      headerHeight: "tall" as const,
      headerBorder: "accent" as const,
    };
    const round = headerConfigFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: headerConfigToItemValues(config),
    });
    expect(round.headerHeight).toBe("tall");
    expect(round.headerBorder).toBe("accent");
  });

  it("defaults headerHeight/headerBorder for a legacy item missing them", () => {
    // A header singleton written before these fields existed has no values
    // for them; the reader fills the standard/hairline defaults.
    const round = headerConfigFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: {},
    });
    expect(round.headerHeight).toBe("standard");
    expect(round.headerBorder).toBe("hairline");
  });

  it("returns DEFAULT_HEADER_CONFIG when the item is null", () => {
    expect(headerConfigFromItem(null)).toEqual(DEFAULT_HEADER_CONFIG);
  });
});

describe("appearance: config ↔ item round-trip", () => {
  it("preserves colors and typography settings", () => {
    const config = {
      ...DEFAULT_APPEARANCE,
      colors: { ...DEFAULT_APPEARANCE.colors, primary: "#ff0066" },
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        bodyFont: "Lato",
        headingMode: "split" as const,
        headingFont: "Playfair Display",
      },
    };
    const round = appearanceFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: appearanceToItemValues(config),
    });
    expect(round.colors.primary).toBe("#ff0066");
    expect(round.typography.bodyFont).toBe("Lato");
    expect(round.typography.headingMode).toBe("split");
    expect(round.typography.headingFont).toBe("Playfair Display");
  });

  it("preserves font weights as numbers (not strings)", () => {
    const config = {
      ...DEFAULT_APPEARANCE,
      typography: {
        ...DEFAULT_APPEARANCE.typography,
        bodyWeights: { body: 300, bodyBold: 600 },
        headingWeights: { h1: 800, h2: 700, h3: 600 },
      },
    };
    const round = appearanceFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: appearanceToItemValues(config),
    });
    expect(round.typography.bodyWeights.body).toBe(300);
    expect(round.typography.headingWeights.h1).toBe(800);
  });

  it("preserves the design tokens + display font", () => {
    const config = {
      ...DEFAULT_APPEARANCE,
      typography: { ...DEFAULT_APPEARANCE.typography, displayFont: "Anton" },
      design: {
        ...DEFAULT_APPEARANCE.design!,
        density: "compact" as const,
        radius: "sharp" as const,
        buttonShape: "square" as const,
        accentMode: "gradient" as const,
        accentGradient: { from: "#ff0000", via: "", to: "#0000ff" },
        footerStyle: "inverse" as const,
        grain: true,
      },
    };
    const round = appearanceFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: appearanceToItemValues(config),
    });
    expect(round.typography.displayFont).toBe("Anton");
    expect(round.design?.density).toBe("compact");
    expect(round.design?.radius).toBe("sharp");
    expect(round.design?.accentMode).toBe("gradient");
    expect(round.design?.accentGradient.to).toBe("#0000ff");
    expect(round.design?.footerStyle).toBe("inverse");
    expect(round.design?.grain).toBe(true);
  });

  it("falls back to default design when the design blob is absent/corrupt", () => {
    const round = appearanceFromItem({
      id: "i",
      slug: "_singleton",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: { fld_appearance_design: { type: "text", value: "{not json" } },
    });
    expect(round.design?.density).toBe(DEFAULT_APPEARANCE.design!.density);
  });

  it("returns DEFAULT_APPEARANCE when the item is null", () => {
    expect(appearanceFromItem(null)).toEqual(DEFAULT_APPEARANCE);
  });
});
