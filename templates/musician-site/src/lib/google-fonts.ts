/**
 * Curated Google Fonts for the Appearance picker.
 *
 * Node-import-free on purpose: the admin forms are `"use client"`, so they
 * can import this directly (same discipline as `field-classification.ts` etc.
 * — never reach for the collections barrel from a client file).
 *
 * What we persist is only the family *string* (`typographySchema` keeps
 * `bodyFont` / `headingFont` / `displayFont` as bare strings — forward-
 * compatible). The category is a UI-only affordance, derived from the family
 * via `GOOGLE_FONTS_BY_FAMILY`; `"custom"` lets the artist type any family.
 */

export const FONT_CATEGORIES = [
  "sans-serif",
  "serif",
  "monospace",
  "display",
  "handwriting",
  "custom",
] as const;
export type FontCategory = (typeof FONT_CATEGORIES)[number];

/** Categories that map to a curated family list (everything but `custom`). */
export type CuratedFontCategory = Exclude<FontCategory, "custom">;

export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  "sans-serif": "Sans-serif",
  serif: "Serif",
  monospace: "Monospace",
  display: "Display",
  handwriting: "Handwriting",
  custom: "Custom (any Google Font)",
};

/** CSS generic family appended after the chosen family as a fallback. */
export type CssGenericFamily = "sans-serif" | "serif" | "monospace" | "cursive";

export type GoogleFont = {
  family: string;
  /** CSS generic to fall back to if the webfont fails to load. */
  fallback: CssGenericFamily;
};

const GENERIC_BY_CATEGORY: Record<CuratedFontCategory, CssGenericFamily> = {
  "sans-serif": "sans-serif",
  serif: "serif",
  monospace: "monospace",
  // Display faces are overwhelmingly sans-ish; a sans-serif fallback reads
  // closer than serif/cursive if the webfont is slow.
  display: "sans-serif",
  handwriting: "cursive",
};

const FAMILIES: Record<CuratedFontCategory, string[]> = {
  "sans-serif": [
    "Inter",
    "Roboto",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Poppins",
    "Raleway",
    "Work Sans",
    "Nunito",
    "Source Sans 3",
    "DM Sans",
    "Rubik",
    "Manrope",
    "Plus Jakarta Sans",
    "Outfit",
  ],
  serif: [
    "Merriweather",
    "Playfair Display",
    "Lora",
    "PT Serif",
    "Cormorant Garamond",
    "Libre Baskerville",
    "EB Garamond",
    "Crimson Text",
    "Bitter",
    "Source Serif 4",
    "Spectral",
  ],
  monospace: [
    "JetBrains Mono",
    "Fira Code",
    "Source Code Pro",
    "IBM Plex Mono",
    "Roboto Mono",
    "Inconsolata",
    "Space Mono",
  ],
  display: [
    "Abril Fatface",
    "Bebas Neue",
    "Oswald",
    "Fjalla One",
    "Archivo Black",
    "Anton",
    "Alfa Slab One",
    "Righteous",
  ],
  handwriting: [
    "Caveat",
    "Dancing Script",
    "Pacifico",
    "Kalam",
    "Shadows Into Light",
    "Sacramento",
    "Satisfy",
  ],
};

export const CURATED_FONT_CATEGORIES = Object.keys(FAMILIES) as CuratedFontCategory[];

/** Curated families per category, each tagged with its CSS generic fallback. */
export const GOOGLE_FONTS: Record<CuratedFontCategory, GoogleFont[]> = Object.fromEntries(
  CURATED_FONT_CATEGORIES.map((category) => [
    category,
    FAMILIES[category].map((family) => ({ family, fallback: GENERIC_BY_CATEGORY[category] })),
  ]),
) as Record<CuratedFontCategory, GoogleFont[]>;

/** Flat family → { category, fallback } lookup for reverse mapping. */
export const GOOGLE_FONTS_BY_FAMILY: Record<
  string,
  { category: CuratedFontCategory; fallback: CssGenericFamily }
> = Object.fromEntries(
  CURATED_FONT_CATEGORIES.flatMap((category) =>
    FAMILIES[category].map((family) => [
      family,
      { category, fallback: GENERIC_BY_CATEGORY[category] },
    ]),
  ),
);

/**
 * Which picker category a stored family belongs to. Families not in the
 * curated set (an artist typed their own) report `"custom"`.
 */
export function fontCategoryForFamily(family: string): FontCategory {
  return GOOGLE_FONTS_BY_FAMILY[family]?.category ?? "custom";
}

/**
 * `'Family', <generic>` font stack. Curated families get their category's
 * generic; anything else falls back to sans-serif. Empty input yields an
 * empty string so callers can treat "no font" distinctly.
 */
export function buildFontStack(family: string): string {
  const trimmed = family.trim();
  if (trimmed.length === 0) return "";
  const generic = GOOGLE_FONTS_BY_FAMILY[trimmed]?.fallback ?? "sans-serif";
  return `'${trimmed}', ${generic}`;
}
