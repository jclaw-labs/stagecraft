/**
 * Curated theme presets for the first-run wizard (ADR-013).
 *
 * A theme bundles a complete Appearance palette + typography with a
 * header *style* (mode / layout / wordmark sizing / foreground /
 * uppercase) into one named, one-click choice. Presets reuse the
 * `Appearance` and `HeaderConfig` shapes from `site-config-types` — no
 * new token vocabulary.
 *
 * A theme deliberately does NOT define the `wordmark` image or the
 * `headerSubtitle`: those are artist-owned and must survive a theme
 * change (see `resolveTheme`).
 *
 * `THEME_IDS` is the single source of truth for which themes exist; the
 * `Record<ThemeId, …>` shape of `THEME_PRESETS` makes TypeScript enforce
 * exactly one preset per id. `DEFAULT_THEME_ID` is applied for the
 * "start empty" path and as the safe fallback.
 */
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HEADER_CONFIG,
  type Appearance,
  type HeaderConfig,
} from "./site-config-types";

export const THEME_IDS = [
  "classic",
  "midnight",
  "marquee",
  "lantern",
  "meadow",
  "riot",
  "paper",
  "aurora",
  "vinyl",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "classic";

/**
 * The header fields a theme controls — the *style* of the header, not
 * its content. `wordmark` (the artist's logo) and `headerSubtitle`
 * (their tagline) are excluded so applying a theme never wipes them.
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

// Classic == the platform defaults surfaced as a pickable theme, so the
// "start empty" / default path looks exactly like a fresh site. Derived
// from the DEFAULT_* singletons (not re-typed) so it tracks any change
// to them.
const CLASSIC_HEADER: HeaderStyle = {
  headerMode: DEFAULT_HEADER_CONFIG.headerMode,
  headerLayout: DEFAULT_HEADER_CONFIG.headerLayout,
  wordmarkSizeAdjust: DEFAULT_HEADER_CONFIG.wordmarkSizeAdjust,
  headerForegroundColor: DEFAULT_HEADER_CONFIG.headerForegroundColor,
  isHeaderTextUppercase: DEFAULT_HEADER_CONFIG.isHeaderTextUppercase,
};

export const THEME_PRESETS: Record<ThemeId, ThemePreset> = {
  classic: {
    name: "Classic",
    description: "Navy and crimson on warm white — the timeless default.",
    appearance: DEFAULT_APPEARANCE,
    header: CLASSIC_HEADER,
  },
  midnight: {
    name: "Midnight",
    description: "Luminous type on a deep night palette.",
    appearance: {
      colors: {
        primary: "#f5f5f7",
        secondary: "#e0567a",
        accent: "#7c9cff",
        linkColor: "",
        background: "#0b0b12",
        surface: "#16161f",
        text: "#f5f5f7",
        textMuted: "#a1a1aa",
        border: "#2a2a35",
      },
      typography: {
        bodyFont: "Space Grotesk",
        headingMode: "single",
        headingFont: "",
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 700, h2: 700, h3: 600 },
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
  marquee: {
    name: "Marquee",
    description: "High-contrast poster energy with condensed headlines.",
    appearance: {
      colors: {
        primary: "#0a0a0a",
        secondary: "#e11d2a",
        accent: "#e11d2a",
        linkColor: "",
        background: "#ffffff",
        surface: "#f4f4f5",
        text: "#0a0a0a",
        textMuted: "#52525b",
        border: "#0a0a0a",
      },
      typography: {
        bodyFont: "Inter",
        headingMode: "split",
        headingFont: "Oswald",
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 700, h2: 700, h3: 700 },
      },
    },
    header: {
      headerMode: "solid-static",
      headerLayout: "logo-center-nav-split",
      wordmarkSizeAdjust: 1,
      headerForegroundColor: "",
      isHeaderTextUppercase: true,
    },
  },
  lantern: {
    name: "Lantern",
    description: "Warm gold glow on near-black — cinematic and image-forward.",
    appearance: {
      colors: {
        primary: "#f4f3f0",
        secondary: "#e7c27d",
        accent: "#e7c27d",
        linkColor: "",
        background: "#0b0c0e",
        surface: "#141619",
        text: "#f4f3f0",
        textMuted: "#a7a9ae",
        border: "#282b30",
      },
      typography: {
        bodyFont: "Inter",
        headingMode: "split",
        headingFont: "Space Grotesk",
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 700, h2: 700, h3: 600 },
      },
    },
    header: {
      headerMode: "glass-sticky",
      headerLayout: "logo-left-nav-right",
      wordmarkSizeAdjust: 0,
      headerForegroundColor: "",
      isHeaderTextUppercase: true,
    },
  },
  meadow: {
    name: "Meadow",
    description: "Sun-warmed folk — sage and terracotta on soft cream.",
    appearance: {
      colors: {
        primary: "#3f5135",
        secondary: "#bf6b3a",
        accent: "#cf9248",
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
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 600, h2: 600, h3: 600 },
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
    description: "Acid-lime on black — DIY poster energy.",
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
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 400, h2: 400, h3: 400 },
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
    description: "Editorial black-on-white with a Playfair display serif.",
    appearance: {
      colors: {
        primary: "#111111",
        secondary: "#111111",
        accent: "#111111",
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
        bodyWeights: { body: 400, bodyBold: 600 },
        headingWeights: { h1: 700, h2: 700, h3: 600 },
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
    description: "Dreamy pastels — violet and pink on pale lavender.",
    appearance: {
      colors: {
        primary: "#3a2f5c",
        secondary: "#e0709e",
        accent: "#7b6cd9",
        linkColor: "",
        background: "#f6f3ff",
        surface: "#ffffff",
        text: "#2c2740",
        textMuted: "#7d7795",
        border: "#e7e1f5",
      },
      typography: {
        bodyFont: "Poppins",
        headingMode: "single",
        headingFont: "",
        bodyWeights: { body: 400, bodyBold: 600 },
        headingWeights: { h1: 600, h2: 600, h3: 500 },
      },
    },
    header: {
      headerMode: "glass-sticky",
      headerLayout: "logo-center-nav-below",
      wordmarkSizeAdjust: 0,
      headerForegroundColor: "",
      isHeaderTextUppercase: false,
    },
  },
  vinyl: {
    name: "Vinyl",
    description: "Seventies warmth — burnt orange, mustard, avocado.",
    appearance: {
      colors: {
        primary: "#a8431e",
        secondary: "#c9962f",
        accent: "#4e7a55",
        linkColor: "",
        background: "#f3e9d8",
        surface: "#fbf4e6",
        text: "#2e2218",
        textMuted: "#7c6a54",
        border: "#d8c7a8",
      },
      typography: {
        bodyFont: "DM Sans",
        headingMode: "split",
        headingFont: "Bricolage Grotesque",
        bodyWeights: { body: 400, bodyBold: 700 },
        headingWeights: { h1: 700, h2: 700, h3: 600 },
      },
    },
    header: {
      headerMode: "solid-sticky",
      headerLayout: "logo-left-nav-right",
      wordmarkSizeAdjust: 1,
      headerForegroundColor: "",
      isHeaderTextUppercase: true,
    },
  },
};

/**
 * Apply a theme onto an existing header config. The palette + typography
 * are replaced wholesale by the preset (returned as a fresh copy so the
 * shared preset constant is never mutated downstream); the header *style*
 * fields are overlaid while the artist-owned `wordmark` and
 * `headerSubtitle` survive untouched.
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
