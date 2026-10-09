/**
 * Zod schemas + types for the three editor singletons (site settings,
 * header & navigation, appearance) and the pages list contract.
 *
 * The legacy Astro + Keystatic template put these in `src/lib/schemas.ts`
 * and authored them via Keystatic's form generator. In the new Puck-based
 * template the same files (`src/content/config/site.json`, `header.json`,
 * `appearance.json`) are edited from `/admin/*` panels backed by these
 * schemas.
 *
 * Notes on shape:
 *
 *   - Singleton JSON is stored flat — no Keystatic `{discriminant, value}`
 *     wrappers around optional fields. The legacy template needed those
 *     wrappers to enforce "alt required when src is set" inside Keystatic;
 *     our admin panels enforce that inline.
 *
 *   - Enums use the `as const` + derived union pattern from the root
 *     CLAUDE.md so the form widgets and runtime renderers always read
 *     from one source.
 */
import { z } from "zod";

import { imageMetadataSchema } from "./image-types";

// ---------------------------------------------------------------------------
// Social link platforms
// ---------------------------------------------------------------------------

export const SOCIAL_PLATFORMS = [
  "instagram",
  "twitter",
  "facebook",
  "youtube",
  "spotify",
  "appleMusic",
  "bandcamp",
  "soundcloud",
  "tiktok",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  twitter: "Twitter / X",
  facebook: "Facebook",
  youtube: "YouTube",
  spotify: "Spotify",
  appleMusic: "Apple Music",
  bandcamp: "Bandcamp",
  soundcloud: "SoundCloud",
  tiktok: "TikTok",
};

const socialLinksSchema = z.object(
  Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [p, z.string().default("")]),
  ) as Record<SocialPlatform, z.ZodDefault<z.ZodString>>,
);

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------

export const siteConfigSchema = z.object({
  artistName: z.string().min(1, "Artist name is required"),
  siteTitle: z.string().min(1, "Site title is required"),
  siteDescription: z.string().default(""),
  socialLinks: socialLinksSchema.default(
    () =>
      Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, ""])) as Record<
        SocialPlatform,
        string
      >,
  ),
  contactEmail: z.string().email("Contact email must be a valid email"),
  copyrightName: z.string().default(""),
  isFooterHidden: z.boolean().default(false),
  // Site-wide chrome customisation — parity with legacy
  // `siteConfig.favicon` / `siteConfig.pageBackground`. Both are
  // optional (most sites use the default favicon + a plain
  // background) and both round-trip the full `ImageMetadata` shape
  // so the renderer can pick a variant and the LQIP placeholder.
  favicon: imageMetadataSchema.nullable().default(null),
  pageBackground: imageMetadataSchema.nullable().default(null),
  // Opacity of a black tint painted over the page-background image
  // for text-legibility on bright / busy backgrounds. 0 = no tint
  // (default — the artist's image shows through unchanged); 1 =
  // fully opaque (the background is invisible). Most sites pick
  // 0.2-0.5 when they need it. Only applied when `pageBackground`
  // is set; cosmetic-only when it's null.
  pageBackgroundOverlay: z.number().min(0).max(1).default(0),
  // Canonical order of pages in the admin Pages list AND in the public
  // header nav. Slugs not present here get appended alphabetically when
  // surfaced, so a freshly-created page shows up at the end of the list
  // without needing an explicit write here.
  pageOrder: z.array(z.string().min(1)).default([]),
  // Slugs hidden from the public header nav. Still reachable by URL —
  // this is the "link-in-bio page" escape hatch the legacy template
  // expressed through omission from `header.items`.
  hiddenFromNav: z.array(z.string().min(1)).default([]),
  // True once the artist has completed the first-run welcome wizard.
  // Drives the `/admin` redirect: false → /admin/welcome, true →
  // /admin/pages. Defaults to false so a fresh artist repo (no
  // singleton on disk) walks into the wizard.
  hasCompletedFirstRun: z.boolean().default(false),
});
export type SiteConfig = z.infer<typeof siteConfigSchema>;

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  artistName: "Artist Name",
  siteTitle: "Artist Name — Official Website",
  siteDescription: "",
  socialLinks: Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [p, ""]),
  ) as Record<SocialPlatform, string>,
  contactEmail: "contact@example.com",
  copyrightName: "",
  isFooterHidden: false,
  favicon: null,
  pageBackground: null,
  pageBackgroundOverlay: 0,
  pageOrder: [],
  hiddenFromNav: [],
  hasCompletedFirstRun: false,
};

// ---------------------------------------------------------------------------
// Header mode / layout (re-derived from the legacy template — same values
// so existing artist content keeps round-tripping)
// ---------------------------------------------------------------------------

export const HEADER_MODES = [
  "solid-sticky",
  "solid-static",
  "transparent-static",
  "glass-sticky",
] as const;
export type HeaderMode = (typeof HEADER_MODES)[number];

export const HEADER_MODE_LABELS: Record<HeaderMode, string> = {
  "solid-sticky": "Solid, sticky (default)",
  "solid-static": "Solid, scrolls with page",
  "transparent-static": "Transparent, scrolls with page",
  "glass-sticky": "Glass — translucent + blurred, sticky",
};

export function isTransparentHeader(mode: HeaderMode): boolean {
  return mode === "transparent-static";
}

// Translucent surface + backdrop-blur, sticky over the scrolling page.
export function isGlassHeader(mode: HeaderMode): boolean {
  return mode === "glass-sticky";
}

export function isStickyHeader(mode: HeaderMode): boolean {
  return mode === "solid-sticky" || mode === "glass-sticky";
}

export const HEADER_LAYOUTS = [
  "logo-left-nav-right",
  "logo-center-nav-below",
  "logo-center-nav-split",
] as const;
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];

export const HEADER_LAYOUT_LABELS: Record<HeaderLayout, string> = {
  "logo-left-nav-right": "Logo left, nav right (default)",
  "logo-center-nav-below": "Logo centered, nav below",
  "logo-center-nav-split": "Logo centered, nav split left/right",
};

export const HEADER_HEIGHTS = ["compact", "standard", "tall"] as const;
export type HeaderHeight = (typeof HEADER_HEIGHTS)[number];
export const HEADER_HEIGHT_LABELS: Record<HeaderHeight, string> = {
  compact: "Compact",
  standard: "Standard (default)",
  tall: "Tall",
};

export const HEADER_BORDERS = ["none", "hairline", "bold", "accent"] as const;
export type HeaderBorder = (typeof HEADER_BORDERS)[number];
export const HEADER_BORDER_LABELS: Record<HeaderBorder, string> = {
  none: "None",
  hairline: "Hairline (default)",
  bold: "Bold",
  accent: "Accent color",
};

export const WORDMARK_SIZE_ADJUSTMENTS = [-2, -1, 0, 1, 2] as const;
export type WordmarkSizeAdjustment = (typeof WORDMARK_SIZE_ADJUSTMENTS)[number];

export const WORDMARK_SIZE_ADJUSTMENT_LABELS: Record<string, string> = {
  "-2": "Much smaller (−2)",
  "-1": "Smaller (−1)",
  "0": "Default (0)",
  "1": "Larger (+1)",
  "2": "Much larger (+2)",
};

// ---------------------------------------------------------------------------
// Header & navigation
// ---------------------------------------------------------------------------

export const headerConfigSchema = z.object({
  wordmark: imageMetadataSchema.nullable().default(null),
  wordmarkSizeAdjust: z.coerce
    .number()
    .int()
    .min(-2)
    .max(2)
    .default(0),
  headerMode: z.enum(HEADER_MODES).default("solid-sticky"),
  headerForegroundColor: z.string().default(""),
  isHeaderTextUppercase: z.boolean().default(false),
  headerSubtitle: z.string().default(""),
  headerLayout: z.enum(HEADER_LAYOUTS).default("logo-left-nav-right"),
  // Optional (defaulted at render) so header singletons predating these
  // fields stay valid.
  headerHeight: z.enum(HEADER_HEIGHTS).optional(),
  headerBorder: z.enum(HEADER_BORDERS).optional(),
  // Nav order + visibility moved to `siteConfig.pageOrder` /
  // `siteConfig.hiddenFromNav` — the Pages list is the single editor for
  // both. Zod drops unknown fields by default, so an `items` value left
  // over from a previous version of header.json parses cleanly here.
});
export type HeaderConfig = z.infer<typeof headerConfigSchema>;

export const DEFAULT_HEADER_CONFIG: HeaderConfig = {
  wordmark: null,
  wordmarkSizeAdjust: 0,
  headerMode: "solid-sticky",
  headerForegroundColor: "",
  isHeaderTextUppercase: false,
  headerSubtitle: "",
  headerLayout: "logo-left-nav-right",
  headerHeight: "standard",
  headerBorder: "hairline",
};

// ---------------------------------------------------------------------------
// Appearance — colors + typography. Simpler than the legacy schema (no
// curated Google Fonts categories yet; free-text font family + weights)
// but writes the same on-disk JSON.
// ---------------------------------------------------------------------------

export const COLOR_FIELDS = [
  "primary",
  "secondary",
  "accent",
  "linkColor",
  "background",
  "surface",
  "text",
  "textMuted",
  "border",
] as const;
export type ColorField = (typeof COLOR_FIELDS)[number];

export const COLOR_FIELD_LABELS: Record<ColorField, string> = {
  primary: "Primary (headings, logo)",
  secondary: "Secondary (CTAs, accents)",
  accent: "Accent",
  linkColor: "Link color (blank = use Accent)",
  background: "Page background",
  surface: "Surface (cards, panels)",
  text: "Body text",
  textMuted: "Muted text",
  border: "Borders & dividers",
};

const colorsSchema = z.object({
  primary: z.string().min(1).default("#1a1a2e"),
  secondary: z.string().min(1).default("#b91c4a"),
  accent: z.string().min(1).default("#0f3460"),
  linkColor: z.string().default(""),
  background: z.string().min(1).default("#fafafa"),
  surface: z.string().min(1).default("#ffffff"),
  text: z.string().min(1).default("#1a1a2e"),
  textMuted: z.string().min(1).default("#6b7280"),
  border: z.string().min(1).default("#7c828b"),
});

export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

const fontWeightSchema = z.coerce
  .number()
  .int()
  .refine((n) => (FONT_WEIGHTS as readonly number[]).includes(n), {
    message: "Weight must be a multiple of 100 between 100 and 900",
  });

export const HEADING_MODES = ["single", "split"] as const;
export type HeadingMode = (typeof HEADING_MODES)[number];

export const HEADING_MODE_LABELS: Record<HeadingMode, string> = {
  single: "Same font for everything",
  split: "Different font for headings",
};

const typographySchema = z.object({
  bodyFont: z.string().min(1).default("Inter"),
  headingMode: z.enum(HEADING_MODES).default("single"),
  // Only consulted when headingMode === "split".
  headingFont: z.string().default(""),
  // Optional 3rd font for the wordmark + hero display (blackletter,
  // condensed, etc.). Absent/blank = inherit the heading font.
  displayFont: z.string().optional(),
  bodyWeights: z
    .object({
      body: fontWeightSchema.default(400),
      bodyBold: fontWeightSchema.default(700),
    })
    .default({ body: 400, bodyBold: 700 }),
  headingWeights: z
    .object({
      h1: fontWeightSchema.default(700),
      h2: fontWeightSchema.default(700),
      h3: fontWeightSchema.default(700),
    })
    .default({ h1: 700, h2: 700, h3: 700 }),
});
export type Typography = z.infer<typeof typographySchema>;

// Default values for the optional sub-objects. The hand-rolled `as const`
// shape is necessary because Zod's `.default()` overload checks the input
// against the parsed shape, not the input shape — so empty defaults aren't
// accepted by every key in the sub-object. We supply the full DEFAULTs.
const DEFAULT_COLORS = {
  primary: "#1a1a2e",
  secondary: "#b91c4a",
  accent: "#0f3460",
  linkColor: "",
  background: "#fafafa",
  surface: "#ffffff",
  text: "#1a1a2e",
  textMuted: "#6b7280",
  border: "#7c828b",
};

const DEFAULT_TYPOGRAPHY = {
  bodyFont: "Inter",
  headingMode: "single" as const,
  headingFont: "",
  displayFont: "",
  bodyWeights: { body: 400, bodyBold: 700 },
  headingWeights: { h1: 700, h2: 700, h3: 700 },
};

// ---------------------------------------------------------------------------
// Design system — layout / shape / rule / effect controls (ADR-013 tokenized
// themes). Every field maps to a CSS custom property emitted by
// `AppearanceStyles` and consumed by the shared blocks + Header/Footer. Named
// 3-step scales (not numeric) keep presets legible and prevent incoherent
// layouts.
// ---------------------------------------------------------------------------

export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export type Density = (typeof DENSITIES)[number];

export const CONTENT_WIDTHS = ["narrow", "medium", "wide"] as const;
export type ContentWidth = (typeof CONTENT_WIDTHS)[number];

export const SECTION_ALIGNS = ["left", "center"] as const;
export type SectionAlign = (typeof SECTION_ALIGNS)[number];

export const GUTTERS = ["tight", "normal", "airy"] as const;
export type Gutter = (typeof GUTTERS)[number];

export const RADII = ["sharp", "soft", "round"] as const;
export type Radius = (typeof RADII)[number];

export const BUTTON_SHAPES = ["square", "rounded", "pill"] as const;
export type ButtonShape = (typeof BUTTON_SHAPES)[number];

export const BUTTON_FILLS = ["solid", "outline", "underline"] as const;
export type ButtonFill = (typeof BUTTON_FILLS)[number];

export const SHADOW_STYLES = ["none", "soft", "glow", "hard-offset"] as const;
export type ShadowStyle = (typeof SHADOW_STYLES)[number];

export const RULE_STYLES = ["none", "hairline", "bold", "accent"] as const;
export type RuleStyle = (typeof RULE_STYLES)[number];

export const IMAGE_TREATMENTS = ["plain", "rounded", "framed"] as const;
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];

export const GALLERY_LAYOUTS = ["grid", "portrait", "masonry"] as const;
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];

export const HEADING_CASES = ["none", "upper"] as const;
export type HeadingCase = (typeof HEADING_CASES)[number];

export const HEADING_TRACKINGS = ["tight", "normal", "wide"] as const;
export type HeadingTracking = (typeof HEADING_TRACKINGS)[number];

export const HEADING_SCALES = ["modest", "balanced", "dramatic"] as const;
export type HeadingScale = (typeof HEADING_SCALES)[number];

export const ACCENT_MODES = ["solid", "gradient"] as const;
export type AccentMode = (typeof ACCENT_MODES)[number];

export const FOOTER_STYLES = ["surface", "inverse", "accent"] as const;
export type FooterStyle = (typeof FOOTER_STYLES)[number];

const accentGradientSchema = z.object({
  from: z.string().default(""),
  via: z.string().default(""),
  to: z.string().default(""),
});

export const designSchema = z.object({
  density: z.enum(DENSITIES).default("comfortable"),
  contentWidth: z.enum(CONTENT_WIDTHS).default("medium"),
  sectionAlign: z.enum(SECTION_ALIGNS).default("left"),
  gutter: z.enum(GUTTERS).default("normal"),
  radius: z.enum(RADII).default("soft"),
  buttonShape: z.enum(BUTTON_SHAPES).default("rounded"),
  buttonFill: z.enum(BUTTON_FILLS).default("solid"),
  shadowStyle: z.enum(SHADOW_STYLES).default("soft"),
  ruleStyle: z.enum(RULE_STYLES).default("hairline"),
  imageTreatment: z.enum(IMAGE_TREATMENTS).default("rounded"),
  galleryLayout: z.enum(GALLERY_LAYOUTS).default("grid"),
  headingCase: z.enum(HEADING_CASES).default("none"),
  headingTracking: z.enum(HEADING_TRACKINGS).default("normal"),
  headingScale: z.enum(HEADING_SCALES).default("balanced"),
  accentMode: z.enum(ACCENT_MODES).default("solid"),
  accentGradient: accentGradientSchema.default({ from: "", via: "", to: "" }),
  onAccent: z.string().default(""),
  footerStyle: z.enum(FOOTER_STYLES).default("surface"),
  grain: z.boolean().default(false),
});
export type Design = z.infer<typeof designSchema>;

export const DEFAULT_DESIGN: Design = {
  density: "comfortable",
  contentWidth: "medium",
  sectionAlign: "left",
  gutter: "normal",
  radius: "soft",
  buttonShape: "rounded",
  buttonFill: "solid",
  shadowStyle: "soft",
  ruleStyle: "hairline",
  imageTreatment: "rounded",
  galleryLayout: "grid",
  headingCase: "none",
  headingTracking: "normal",
  headingScale: "balanced",
  accentMode: "solid",
  accentGradient: { from: "", via: "", to: "" },
  onAccent: "",
  footerStyle: "surface",
  grain: false,
};

export const appearanceSchema = z.object({
  colors: colorsSchema.default(DEFAULT_COLORS),
  typography: typographySchema.default(DEFAULT_TYPOGRAPHY),
  // Optional so presets / stored singletons predating the design system stay
  // valid; the renderer merges over DEFAULT_DESIGN.
  design: designSchema.optional(),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = {
  colors: {
    primary: "#1a1a2e",
    secondary: "#b91c4a",
    accent: "#0f3460",
    linkColor: "",
    background: "#fafafa",
    surface: "#ffffff",
    text: "#1a1a2e",
    textMuted: "#6b7280",
    border: "#7c828b",
  },
  typography: {
    bodyFont: "Inter",
    headingMode: "single",
    headingFont: "",
    displayFont: "",
    bodyWeights: { body: 400, bodyBold: 700 },
    headingWeights: { h1: 700, h2: 700, h3: 700 },
  },
  design: DEFAULT_DESIGN,
};

/**
 * Resolve the effective link color — if `linkColor` is blank, fall back
 * to `accent`. Centralised so the header + body renderers don't need to
 * branch on emptiness.
 */
export function resolveLinkColor(colors: Appearance["colors"]): string {
  return colors.linkColor.length > 0 ? colors.linkColor : colors.accent;
}

/**
 * Build the set of Google Font family + weight pairs actually used by an
 * Appearance, so `<head>` can fetch only those — no over-downloading.
 *
 * When mode === "single", all heading weights inherit the body font.
 */
export function appearanceFontFamilies(
  appearance: Appearance,
): { family: string; weights: number[] }[] {
  const bodyWeights = new Set<number>([
    appearance.typography.bodyWeights.body,
    appearance.typography.bodyWeights.bodyBold,
  ]);
  const headingWeights = new Set<number>([
    appearance.typography.headingWeights.h1,
    appearance.typography.headingWeights.h2,
    appearance.typography.headingWeights.h3,
  ]);

  const sortW = (s: Set<number>) => [...s].sort((a, b) => a - b);
  const families: { family: string; weights: number[] }[] = [];

  if (
    appearance.typography.headingMode === "split" &&
    appearance.typography.headingFont.length > 0 &&
    appearance.typography.headingFont !== appearance.typography.bodyFont
  ) {
    families.push({ family: appearance.typography.bodyFont, weights: sortW(bodyWeights) });
    families.push({ family: appearance.typography.headingFont, weights: sortW(headingWeights) });
  } else {
    // Single-font mode (or split-mode but heading inherits body): one family,
    // union of all weights.
    families.push({
      family: appearance.typography.bodyFont,
      weights: sortW(new Set([...bodyWeights, ...headingWeights])),
    });
  }

  // Optional 3rd (display/wordmark) family — loaded only when set and distinct.
  const displayFont = appearance.typography.displayFont ?? "";
  if (displayFont.length > 0 && !families.some((f) => f.family === displayFont)) {
    families.push({ family: displayFont, weights: sortW(headingWeights) });
  }

  return families;
}

// ---------------------------------------------------------------------------
// Per-page settings — what lives on `data.root.props` in a page JSON file.
// Puck stores arbitrary root props; we narrow them to a known shape so
// admin panels and renderers don't have to deal with shape drift.
// ---------------------------------------------------------------------------

export const pageRootPropsSchema = z.object({
  title: z.string().min(1, "Page title is required").default("Untitled"),
  isSplashPage: z.boolean().default(false),
  isFooterHidden: z.boolean().default(false),
  // Per-page override for the site-wide `siteConfig.pageBackground`.
  // When set, paints over the site-wide underlay on this page only —
  // the legacy template let each page declare its own. Optional, so
  // most pages inherit the site-wide background unchanged.
  pageBackground: imageMetadataSchema.nullable().default(null),
  // Per-page overlay opacity override. `null` (default) inherits the
  // site-wide `siteConfig.pageBackgroundOverlay`; a number 0..1
  // overrides it. Distinct null-vs-0 because 0 means "explicit no
  // tint here" while null means "use the site default".
  pageBackgroundOverlay: z.number().min(0).max(1).nullable().default(null),
});
export type PageRootProps = z.infer<typeof pageRootPropsSchema>;

// ---------------------------------------------------------------------------
// Pages list contract — what the admin sidebar reads to populate the
// "Pages" panel. Slug + title only, sorted client-side.
// ---------------------------------------------------------------------------

export const PAGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const pageSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    PAGE_SLUG_PATTERN,
    "Slug must be lowercase letters, digits, and hyphens (start with a letter or digit)",
  );

/**
 * Pure reorder helper for the admin Pages list. Pulls `draggedSlug` out of
 * its current position and inserts it immediately before `targetSlug`. The
 * "insert before" model matches HTML5 drag-and-drop conventions and works
 * symmetrically for upward and downward moves. Returns the input unchanged
 * when either slug is missing.
 */
export function reorderPagesBefore<T extends { slug: string }>(
  pages: readonly T[],
  draggedSlug: string,
  targetSlug: string,
): T[] {
  if (draggedSlug === targetSlug) return [...pages];
  const dragged = pages.find((p) => p.slug === draggedSlug);
  if (!dragged) return [...pages];
  const without = pages.filter((p) => p.slug !== draggedSlug);
  const targetIdx = without.findIndex((p) => p.slug === targetSlug);
  if (targetIdx === -1) return [...pages];
  return [...without.slice(0, targetIdx), dragged, ...without.slice(targetIdx)];
}

export const pageSummarySchema = z.object({
  slug: pageSlugSchema,
  title: z.string(),
  isSplashPage: z.boolean(),
  // Mirrors `siteConfig.hiddenFromNav.includes(slug)` so the admin Pages
  // list can render the eye-icon state without a second fetch.
  isHiddenFromNav: z.boolean(),
});
export type PageSummary = z.infer<typeof pageSummarySchema>;

/**
 * Convert a free-text page title into a URL-safe slug. Lowercased, ASCII-only,
 * hyphen-separated. Returns an empty string for inputs that contain no usable
 * characters so the caller can prompt for a different title.
 */
export function slugifyTitle(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
