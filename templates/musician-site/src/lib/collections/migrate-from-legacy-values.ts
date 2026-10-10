/**
 * Pure value-shape converters between the legacy `SiteConfig` /
 * `HeaderConfig` / `Appearance` shapes and the new `Item["values"]`
 * shape (ADR-009 §13).
 *
 * Lives in its own file (not in `migrate-from-legacy.ts`) so client
 * components — specifically the three custom singleton panels
 * (Site Settings, Header & Navigation, Appearance) — can call
 * `*ToItemValues` at save time without dragging `node:crypto` into
 * the browser bundle via the parent module's `generateItemId`
 * dependency. Same client-bundling discipline as `filter-schema.ts` /
 * `field-classification.ts` / `puck-content-value.ts`.
 *
 * The parent `migrate-from-legacy.ts` re-exports everything here for
 * source-compat plus the item-creating helper (`pageDataToItem`) that
 * needs the runtime crypto import.
 */

import type { Data as PuckData } from "@puckeditor/core";

import type { ImageMetadata } from "../image-types";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_DESIGN,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_SITE_CONFIG,
  designSchema,
  type Appearance,
  type Design,
  type HeaderConfig,
  type PageRootProps,
  type SiteConfig,
  type SocialPlatform,
  COLOR_FIELDS,
  SOCIAL_PLATFORMS,
} from "../site-config-types";

import type { Item } from "./schema";
import {
  APPEARANCE_FIELD_IDS,
  HEADER_FIELD_IDS,
  PAGES_FIELD_IDS,
  SITE_FIELD_IDS,
} from "./field-ids";

// ---------------------------------------------------------------------------
// Pages — value-shape conversion only. Item-creating helper that needs
// crypto stays in `./migrate-from-legacy.ts`.
// ---------------------------------------------------------------------------

/**
 * Convert a Puck `Data` (the legacy page shape) into the value map
 * for a pages item. The page's root props (title, splash flag, footer
 * flag) become typed item field values; the content array stays as a
 * `puckContent` field value with an emptied root.
 *
 * `showInNav` defaults to true for migrated pages — they appeared in
 * the old nav unless `siteConfig.hiddenFromNav` excluded them. The
 * migration script wires that mapping at the call site.
 */
export function pageDataToItemValues(
  data: PuckData,
  opts: { showInNav?: boolean } = {},
): Item["values"] {
  const root = (data.root?.props ?? {}) as Partial<PageRootProps>;
  return {
    [PAGES_FIELD_IDS.title]: { type: "text", value: root.title ?? "Untitled" },
    [PAGES_FIELD_IDS.isSplashPage]: { type: "boolean", value: root.isSplashPage === true },
    [PAGES_FIELD_IDS.isFooterHidden]: { type: "boolean", value: root.isFooterHidden === true },
    [PAGES_FIELD_IDS.showInNav]: { type: "boolean", value: opts.showInNav ?? true },
    [PAGES_FIELD_IDS.body]: {
      type: "puckContent",
      // Strip the page-level root props from the body's Puck data —
      // they live on the item now, not on the body.
      value: { content: data.content ?? [], root: { props: {} } } as PuckData,
    },
  };
}

/** Reconstruct the legacy `PuckData` shape from a pages item. */
export function pageDataFromItem(item: Item): PuckData {
  const body = item.values[PAGES_FIELD_IDS.body];
  const content =
    body && body.type === "puckContent" ? (body.value.content ?? []) : [];
  return {
    content,
    root: {
      props: {
        title: getString(item, PAGES_FIELD_IDS.title) ?? "Untitled",
        isSplashPage: getBoolean(item, PAGES_FIELD_IDS.isSplashPage) ?? false,
        isFooterHidden: getBoolean(item, PAGES_FIELD_IDS.isFooterHidden) ?? false,
      } as PageRootProps,
    },
  };
}

// ---------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------

/**
 * Convert the legacy `SiteConfig` into the item values for the site
 * singleton. `pageOrder` and `hiddenFromNav` are NOT carried — the
 * Pages collection's `_order.json` + each page's `showInNav` field
 * own that data now (ADR-009 §14).
 */
export function siteConfigToItemValues(config: SiteConfig): Item["values"] {
  const values: Item["values"] = {
    [SITE_FIELD_IDS.artistName]: { type: "text", value: config.artistName },
    [SITE_FIELD_IDS.siteTitle]: { type: "text", value: config.siteTitle },
    [SITE_FIELD_IDS.siteDescription]: { type: "longText", value: config.siteDescription },
    [SITE_FIELD_IDS.contactEmail]: { type: "email", value: config.contactEmail },
    [SITE_FIELD_IDS.copyrightName]: { type: "text", value: config.copyrightName },
    [SITE_FIELD_IDS.isFooterHidden]: { type: "boolean", value: config.isFooterHidden },
    [SITE_FIELD_IDS.hasCompletedFirstRun]: {
      type: "boolean",
      value: config.hasCompletedFirstRun,
    },
  };
  // Optional image fields: only write a value when present. Storing a
  // null `image` value would fail the dynamic item schema (image's
  // value is the full ImageMetadata, not nullable), and an absent
  // value tells the renderer to fall back to defaults (template
  // favicon, plain background).
  if (config.favicon) {
    values[SITE_FIELD_IDS.favicon] = { type: "image", value: config.favicon };
  }
  if (config.pageBackground) {
    values[SITE_FIELD_IDS.pageBackground] = {
      type: "image",
      value: config.pageBackground,
    };
  }
  // Overlay opacity only meaningful when a background is set; even
  // so, persist when non-zero (the renderer ignores it without a
  // background, and round-tripping a zero is wasteful disk).
  if (config.pageBackgroundOverlay > 0) {
    values[SITE_FIELD_IDS.pageBackgroundOverlay] = {
      type: "number",
      value: config.pageBackgroundOverlay,
    };
  }
  for (const platform of SOCIAL_PLATFORMS) {
    const url = config.socialLinks[platform];
    // Empty social links are omitted so optional URL fields don't
    // record a failing-validation empty string. Renderers consult
    // hasField anyway.
    if (url && url.length > 0) {
      values[SITE_FIELD_IDS.social(platform)] = { type: "url", value: url };
    }
  }
  return values;
}

/** Reconstruct a `SiteConfig` from the site singleton item. */
export function siteConfigFromItem(item: Item | null): SiteConfig {
  if (!item) return DEFAULT_SITE_CONFIG;
  const socialLinks = Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [p, getString(item, SITE_FIELD_IDS.social(p)) ?? ""]),
  ) as Record<SocialPlatform, string>;
  return {
    artistName: getString(item, SITE_FIELD_IDS.artistName) ?? DEFAULT_SITE_CONFIG.artistName,
    siteTitle: getString(item, SITE_FIELD_IDS.siteTitle) ?? DEFAULT_SITE_CONFIG.siteTitle,
    siteDescription: getString(item, SITE_FIELD_IDS.siteDescription) ?? "",
    socialLinks,
    contactEmail:
      getString(item, SITE_FIELD_IDS.contactEmail) ?? DEFAULT_SITE_CONFIG.contactEmail,
    copyrightName: getString(item, SITE_FIELD_IDS.copyrightName) ?? "",
    isFooterHidden: getBoolean(item, SITE_FIELD_IDS.isFooterHidden) ?? false,
    favicon: getImageOrNull(item, SITE_FIELD_IDS.favicon),
    pageBackground: getImageOrNull(item, SITE_FIELD_IDS.pageBackground),
    pageBackgroundOverlay: clampOverlayOpacity(
      getNumber(item, SITE_FIELD_IDS.pageBackgroundOverlay),
    ),
    // Absent flag on a pre-existing site → treat as not-yet-completed
    // so older repos see the wizard on next visit. New repos write the
    // field explicitly through the wizard or the dev seed.
    hasCompletedFirstRun:
      getBoolean(item, SITE_FIELD_IDS.hasCompletedFirstRun) ?? false,
    // pageOrder + hiddenFromNav are derived from the Pages collection
    // (ADR-009 §14). Surfaced via separate accessors in content.ts.
    pageOrder: [],
    hiddenFromNav: [],
  };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function headerConfigToItemValues(config: HeaderConfig): Item["values"] {
  const values: Item["values"] = {
    [HEADER_FIELD_IDS.wordmarkSizeAdjust]: {
      type: "number",
      value: config.wordmarkSizeAdjust,
    },
    [HEADER_FIELD_IDS.headerMode]: { type: "select", value: config.headerMode },
    [HEADER_FIELD_IDS.headerForegroundColor]: {
      type: "text",
      value: config.headerForegroundColor,
    },
    [HEADER_FIELD_IDS.isHeaderTextUppercase]: {
      type: "boolean",
      value: config.isHeaderTextUppercase,
    },
    [HEADER_FIELD_IDS.headerSubtitle]: { type: "text", value: config.headerSubtitle },
    [HEADER_FIELD_IDS.headerLayout]: { type: "select", value: config.headerLayout },
    [HEADER_FIELD_IDS.headerHeight]: {
      type: "select",
      value: config.headerHeight ?? "standard",
    },
    [HEADER_FIELD_IDS.headerBorder]: {
      type: "select",
      value: config.headerBorder ?? "hairline",
    },
  };
  if (config.wordmark !== null) {
    values[HEADER_FIELD_IDS.wordmark] = { type: "image", value: config.wordmark };
  }
  return values;
}

export function headerConfigFromItem(item: Item | null): HeaderConfig {
  if (!item) return DEFAULT_HEADER_CONFIG;
  const wordmarkValue = item.values[HEADER_FIELD_IDS.wordmark];
  const wordmark: ImageMetadata | null =
    wordmarkValue && wordmarkValue.type === "image" ? wordmarkValue.value : null;
  return {
    wordmark,
    wordmarkSizeAdjust: clampWordmarkSizeAdjust(
      getNumber(item, HEADER_FIELD_IDS.wordmarkSizeAdjust) ?? 0,
    ),
    headerMode:
      (getString(item, HEADER_FIELD_IDS.headerMode) as HeaderConfig["headerMode"]) ??
      DEFAULT_HEADER_CONFIG.headerMode,
    headerForegroundColor: getString(item, HEADER_FIELD_IDS.headerForegroundColor) ?? "",
    isHeaderTextUppercase: getBoolean(item, HEADER_FIELD_IDS.isHeaderTextUppercase) ?? false,
    headerSubtitle: getString(item, HEADER_FIELD_IDS.headerSubtitle) ?? "",
    headerLayout:
      (getString(item, HEADER_FIELD_IDS.headerLayout) as HeaderConfig["headerLayout"]) ??
      DEFAULT_HEADER_CONFIG.headerLayout,
    headerHeight:
      (getString(item, HEADER_FIELD_IDS.headerHeight) as HeaderConfig["headerHeight"]) ??
      "standard",
    headerBorder:
      (getString(item, HEADER_FIELD_IDS.headerBorder) as HeaderConfig["headerBorder"]) ??
      "hairline",
  };
}

function clampWordmarkSizeAdjust(n: number): -2 | -1 | 0 | 1 | 2 {
  const r = Math.max(-2, Math.min(2, Math.round(n)));
  return r as -2 | -1 | 0 | 1 | 2;
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

export function appearanceToItemValues(appearance: Appearance): Item["values"] {
  const values: Item["values"] = {};
  for (const color of COLOR_FIELDS) {
    values[APPEARANCE_FIELD_IDS.color(color)] = {
      type: "text",
      value: appearance.colors[color],
    };
  }
  values[APPEARANCE_FIELD_IDS.bodyFont] = {
    type: "text",
    value: appearance.typography.bodyFont,
  };
  values[APPEARANCE_FIELD_IDS.headingMode] = {
    type: "select",
    value: appearance.typography.headingMode,
  };
  values[APPEARANCE_FIELD_IDS.headingFont] = {
    type: "text",
    value: appearance.typography.headingFont,
  };
  values[APPEARANCE_FIELD_IDS.displayFont] = {
    type: "text",
    value: appearance.typography.displayFont ?? "",
  };
  values[APPEARANCE_FIELD_IDS.design] = {
    type: "text",
    value: JSON.stringify(appearance.design ?? DEFAULT_DESIGN),
  };
  values[APPEARANCE_FIELD_IDS.bodyWeight_body] = {
    type: "select",
    value: String(appearance.typography.bodyWeights.body),
  };
  values[APPEARANCE_FIELD_IDS.bodyWeight_bodyBold] = {
    type: "select",
    value: String(appearance.typography.bodyWeights.bodyBold),
  };
  values[APPEARANCE_FIELD_IDS.headingWeight_h1] = {
    type: "select",
    value: String(appearance.typography.headingWeights.h1),
  };
  values[APPEARANCE_FIELD_IDS.headingWeight_h2] = {
    type: "select",
    value: String(appearance.typography.headingWeights.h2),
  };
  values[APPEARANCE_FIELD_IDS.headingWeight_h3] = {
    type: "select",
    value: String(appearance.typography.headingWeights.h3),
  };
  return values;
}

function designFromValue(raw: string | null): Design {
  if (!raw) return DEFAULT_DESIGN;
  try {
    return designSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_DESIGN;
  }
}

export function appearanceFromItem(item: Item | null): Appearance {
  if (!item) return DEFAULT_APPEARANCE;
  const colors = Object.fromEntries(
    COLOR_FIELDS.map((c) => [
      c,
      getString(item, APPEARANCE_FIELD_IDS.color(c)) ?? DEFAULT_APPEARANCE.colors[c],
    ]),
  ) as Appearance["colors"];
  const weight = (id: string, fallback: number): number => {
    const raw = getString(item, id);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    colors,
    design: designFromValue(getString(item, APPEARANCE_FIELD_IDS.design)),
    typography: {
      bodyFont:
        getString(item, APPEARANCE_FIELD_IDS.bodyFont) ?? DEFAULT_APPEARANCE.typography.bodyFont,
      headingMode:
        (getString(item, APPEARANCE_FIELD_IDS.headingMode) as Appearance["typography"]["headingMode"]) ??
        DEFAULT_APPEARANCE.typography.headingMode,
      headingFont: getString(item, APPEARANCE_FIELD_IDS.headingFont) ?? "",
      displayFont: getString(item, APPEARANCE_FIELD_IDS.displayFont) ?? "",
      bodyWeights: {
        body: weight(APPEARANCE_FIELD_IDS.bodyWeight_body, 400) as Appearance["typography"]["bodyWeights"]["body"],
        bodyBold: weight(
          APPEARANCE_FIELD_IDS.bodyWeight_bodyBold,
          700,
        ) as Appearance["typography"]["bodyWeights"]["bodyBold"],
      },
      headingWeights: {
        h1: weight(APPEARANCE_FIELD_IDS.headingWeight_h1, 700) as Appearance["typography"]["headingWeights"]["h1"],
        h2: weight(APPEARANCE_FIELD_IDS.headingWeight_h2, 700) as Appearance["typography"]["headingWeights"]["h2"],
        h3: weight(APPEARANCE_FIELD_IDS.headingWeight_h3, 700) as Appearance["typography"]["headingWeights"]["h3"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Small value extractors (untyped fallbacks for the conversion paths)
// ---------------------------------------------------------------------------

function getString(item: Item, fieldId: string): string | null {
  const v = item.values[fieldId];
  if (!v) return null;
  switch (v.type) {
    case "text":
    case "longText":
    case "date":
    case "url":
    case "email":
    case "color":
    case "select":
      return v.value;
    default:
      return null;
  }
}

function getBoolean(item: Item, fieldId: string): boolean | null {
  const v = item.values[fieldId];
  return v && v.type === "boolean" ? v.value : null;
}

function getNumber(item: Item, fieldId: string): number | null {
  const v = item.values[fieldId];
  return v && v.type === "number" ? v.value : null;
}

function getImageOrNull(item: Item, fieldId: string): ImageMetadata | null {
  const v = item.values[fieldId];
  return v && v.type === "image" ? v.value : null;
}

/**
 * Clamp a stored overlay opacity into 0..1 and substitute 0 for
 * missing / out-of-range values. Defensive against hand-edited JSON
 * carrying a stale or wild number.
 */
function clampOverlayOpacity(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
