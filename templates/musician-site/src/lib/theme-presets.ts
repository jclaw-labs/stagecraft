/**
 * Curated theme presets for the first-run wizard (ADR-013, tokenized themes).
 *
 * A theme bundles a complete Appearance — palette + typography + the design
 * token group (layout / shape / detail) — with a header *style* into one
 * named, one-click choice. Presets reuse the `Appearance` and `HeaderConfig`
 * shapes from `site-config-types`; no new token vocabulary.
 *
 * A theme deliberately does NOT define the `wordmark` image or the
 * `headerSubtitle`: those are artist-owned and must survive a theme change
 * (see `resolveTheme`).
 *
 * `THEME_IDS` is the single source of truth; the `Record<ThemeId, …>` shape of
 * `THEME_PRESETS` makes TypeScript enforce exactly one preset per id.
 * `DEFAULT_THEME_ID` is applied for the "start empty" path and as the fallback.
 *
 * The directions come from the design comps in `design/theme-comps/`. This is
 * the first batch (the 5 originals as full design bundles); the remaining
 * directions (ink, ember, redwood, mahogany, oak, pulse, concrete, candy,
 * obsidian, cobalt) land in a follow-up.
 */
import { type Appearance, type HeaderConfig } from "./site-config-types";

export const THEME_IDS = ["meadow", "riot", "paper", "aurora", "vinyl"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "meadow";

/**
 * The header fields a theme controls — the *style* of the header, not its
 * content. `wordmark` + `headerSubtitle` are excluded so applying a theme
 * never wipes them.
 */
export type HeaderStyle = Pick<
  HeaderConfig,
  | "headerMode"
  | "headerLayout"
  | "wordmarkSizeAdjust"
  | "headerForegroundColor"
  | "isHeaderTextUppercase"
>;

export interface ThemePreset {
  /** Display name for the picker card. */
  name: string;
  /** One-line description for the picker card. */
  description: string;
  appearance: Appearance;
  header: HeaderStyle;
}

const NO_GRADIENT = { from: "", via: "", to: "" };

export const THEME_PRESETS: Record<ThemeId, ThemePreset> = {
  meadow: {
    name: "Meadow",
    description: "Wholesome warm folk — sage, terracotta, and amber on soft cream.",
    appearance: {
      colors: {
        primary: "#3f5135",
        secondary: "#cf9248",
        accent: "#bf6b3a",
        linkColor: "",
        background: "#fbf7f0",
        surface: "#ffffff",
        text: "#3a342c",
        textMuted: "#7a7165",
        border: "#e4ddd0",
      },
      typography: {
        bodyFont: "Nunito Sans",
        headingMode: "split",
        headingFont: "Fraunces",
        displayFont: "",
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 600, h2: 600, h3: 600 },
      },
      design: {
        density: "spacious",
        contentWidth: "medium",
        sectionAlign: "left",
        gutter: "airy",
        radius: "round",
        buttonShape: "pill",
        buttonFill: "solid",
        shadowStyle: "soft",
        ruleStyle: "hairline",
        imageTreatment: "rounded",
        galleryLayout: "grid",
        headingCase: "none",
        headingTracking: "normal",
        headingScale: "balanced",
        accentMode: "solid",
        accentGradient: NO_GRADIENT,
        onAccent: "#ffffff",
        footerStyle: "inverse",
        grain: false,
      },
    },
    header: {
      headerMode: "solid-sticky",
      headerLayout: "logo-left-nav-right",
      wordmarkSizeAdjust: 0,
      headerForegroundColor: "",
      isHeaderTextUppercase: false,
    },
  },
  riot: {
    name: "Riot",
    description: "Edgy DIY punk — acid lime on black, oversized condensed caps.",
    appearance: {
      colors: {
        primary: "#f2f2f2",
        secondary: "#c8ff2f",
        accent: "#c8ff2f",
        linkColor: "",
        background: "#0a0a0a",
        surface: "#161616",
        text: "#f2f2f2",
        textMuted: "#8a8a8a",
        border: "#2a2a2a",
      },
      typography: {
        bodyFont: "Space Mono",
        headingMode: "split",
        headingFont: "Anton",
        displayFont: "Anton",
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 400, h2: 400, h3: 400 },
      },
      design: {
        density: "compact",
        contentWidth: "wide",
        sectionAlign: "left",
        gutter: "tight",
        radius: "sharp",
        buttonShape: "square",
        buttonFill: "solid",
        shadowStyle: "hard-offset",
        ruleStyle: "bold",
        imageTreatment: "plain",
        galleryLayout: "grid",
        headingCase: "upper",
        headingTracking: "tight",
        headingScale: "dramatic",
        accentMode: "solid",
        accentGradient: NO_GRADIENT,
        onAccent: "#0a0a0a",
        footerStyle: "surface",
        grain: false,
      },
    },
    header: {
      headerMode: "solid-sticky",
      headerLayout: "logo-left-nav-right",
      wordmarkSizeAdjust: 0,
      headerForegroundColor: "",
      isHeaderTextUppercase: true,
    },
  },
  paper: {
    name: "Paper",
    description: "Minimal editorial — black on white, dramatic Playfair display.",
    appearance: {
      colors: {
        primary: "#111111",
        secondary: "#111111",
        accent: "#555555",
        linkColor: "",
        background: "#ffffff",
        surface: "#ffffff",
        text: "#1a1a1a",
        textMuted: "#737373",
        border: "#e6e6e6",
      },
      typography: {
        bodyFont: "Inter",
        headingMode: "split",
        headingFont: "Playfair Display",
        displayFont: "",
        bodyWeights: { body: 400, bodyBold: 600 },
        headingWeights: { h1: 700, h2: 700, h3: 600 },
      },
      design: {
        density: "spacious",
        contentWidth: "narrow",
        sectionAlign: "center",
        gutter: "airy",
        radius: "sharp",
        buttonShape: "square",
        buttonFill: "underline",
        shadowStyle: "none",
        ruleStyle: "hairline",
        imageTreatment: "plain",
        galleryLayout: "masonry",
        headingCase: "none",
        headingTracking: "normal",
        headingScale: "dramatic",
        accentMode: "solid",
        accentGradient: NO_GRADIENT,
        onAccent: "#ffffff",
        footerStyle: "surface",
        grain: false,
      },
    },
    header: {
      headerMode: "solid-sticky",
      headerLayout: "logo-center-nav-below",
      wordmarkSizeAdjust: 0,
      headerForegroundColor: "",
      isHeaderTextUppercase: false,
    },
  },
  aurora: {
    name: "Aurora",
    description: "Dreamy pastel — Cormorant serif on a hazy, muted lavender.",
    appearance: {
      colors: {
        primary: "#3a2f5c",
        secondary: "#e0709e",
        accent: "#7b6cd9",
        linkColor: "",
        background: "#e9e6ef",
        surface: "#f4f1f8",
        text: "#2a2740",
        textMuted: "#736f88",
        border: "#dad4e4",
      },
      typography: {
        bodyFont: "Inter",
        headingMode: "split",
        headingFont: "Cormorant Garamond",
        displayFont: "",
        bodyWeights: { body: 400, bodyBold: 500 },
        headingWeights: { h1: 500, h2: 500, h3: 500 },
      },
      design: {
        density: "spacious",
        contentWidth: "medium",
        sectionAlign: "center",
        gutter: "normal",
        radius: "round",
        buttonShape: "pill",
        buttonFill: "underline",
        shadowStyle: "glow",
        ruleStyle: "hairline",
        imageTreatment: "rounded",
        galleryLayout: "grid",
        headingCase: "none",
        headingTracking: "normal",
        headingScale: "dramatic",
        accentMode: "solid",
        accentGradient: NO_GRADIENT,
        onAccent: "#ffffff",
        footerStyle: "surface",
        grain: true,
      },
    },
    header: {
      headerMode: "transparent-static",
      headerLayout: "logo-center-nav-below",
      wordmarkSizeAdjust: 0,
      headerForegroundColor: "#ffffff",
      isHeaderTextUppercase: false,
    },
  },
  vinyl: {
    name: "Vinyl",
    description: "Refined warm analog — rust, ochre, and espresso on oat.",
    appearance: {
      colors: {
        primary: "#a9542c",
        secondary: "#bd8a3a",
        accent: "#a9542c",
        linkColor: "",
        background: "#efe7d4",
        surface: "#f7f0df",
        text: "#2c2118",
        textMuted: "#8a7a63",
        border: "#ddd0b4",
      },
      typography: {
        bodyFont: "DM Sans",
        headingMode: "split",
        headingFont: "Bricolage Grotesque",
        displayFont: "",
        bodyWeights: { body: 400, bodyBold: 500 },
        headingWeights: { h1: 600, h2: 600, h3: 600 },
      },
      design: {
        density: "comfortable",
        contentWidth: "medium",
        sectionAlign: "left",
        gutter: "normal",
        radius: "soft",
        buttonShape: "rounded",
        buttonFill: "solid",
        shadowStyle: "soft",
        ruleStyle: "hairline",
        imageTreatment: "framed",
        galleryLayout: "grid",
        headingCase: "none",
        headingTracking: "tight",
        headingScale: "balanced",
        accentMode: "solid",
        accentGradient: NO_GRADIENT,
        onAccent: "#f7f0df",
        footerStyle: "inverse",
        grain: false,
      },
    },
    header: {
      headerMode: "solid-sticky",
      headerLayout: "logo-left-nav-right",
      wordmarkSizeAdjust: 0,
      headerForegroundColor: "",
      isHeaderTextUppercase: true,
    },
  },
};

/**
 * Apply a theme onto an existing header config. The palette + typography +
 * design are replaced wholesale by the preset (a fresh copy so the shared
 * constant is never mutated); the header *style* fields are overlaid while the
 * artist-owned `wordmark` and `headerSubtitle` survive untouched.
 */
export function resolveTheme(
  id: ThemeId,
  existingHeader: HeaderConfig,
): { appearance: Appearance; header: HeaderConfig } {
  const preset = THEME_PRESETS[id];
  return {
    appearance: structuredClone(preset.appearance),
    header: { ...existingHeader, ...preset.header },
  };
}
