/**
 * WCAG contrast helpers for the Appearance a11y guardrails.
 *
 * Node-import-free so the `"use client"` Appearance form can call it to warn
 * (non-blocking) when an artist's palette pairs fail WCAG AA. Pure math on
 * `#rgb` / `#rrggbb` strings; non-hex values (e.g. a blank token) are skipped
 * by returning `null` from the parsers.
 */

/** WCAG 2.x AA minimum contrast ratio for normal-size body text. */
export const WCAG_AA_NORMAL = 4.5;
/** WCAG 2.x AA minimum for large text (≥18.66px bold / 24px regular). */
export const WCAG_AA_LARGE = 3;

/** Parse `#rgb` or `#rrggbb` into 0–255 channels; `null` for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** sRGB relative luminance (0 = black, 1 = white); `null` for non-hex input. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio (1–21) between two colors; `null` if either isn't hex. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastPair = {
  /** Human-readable label, e.g. "Text on background". */
  label: string;
  fg: string;
  bg: string;
};

export type ContrastResult = ContrastPair & {
  ratio: number;
  /** Passes WCAG AA for normal body text (≥ 4.5:1). */
  passesAA: boolean;
};

/**
 * The color pairs whose contrast actually matters for legibility — body and
 * muted text on the page + card surfaces, links, and the on-accent label that
 * sits on accent-filled buttons. `onAccent` falls back to `surface` (the same
 * default `AppearanceStyles` uses) when the artist hasn't set it.
 */
export function appearanceContrastPairs(
  colors: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
    linkColor: string;
  },
  onAccent: string,
): ContrastPair[] {
  const link = colors.linkColor.trim().length > 0 ? colors.linkColor : colors.accent;
  const onAccentColor = onAccent.trim().length > 0 ? onAccent : colors.surface;
  return [
    { label: "Body text on background", fg: colors.text, bg: colors.background },
    { label: "Body text on surface", fg: colors.text, bg: colors.surface },
    { label: "Muted text on background", fg: colors.textMuted, bg: colors.background },
    { label: "Muted text on surface", fg: colors.textMuted, bg: colors.surface },
    { label: "Links on background", fg: link, bg: colors.background },
    { label: "Button label on accent", fg: onAccentColor, bg: colors.accent },
  ];
}

/**
 * Evaluate every legibility-critical pair. Pairs with a non-hex color are
 * skipped (can't measure). Returns each measurable pair with its ratio +
 * AA verdict; callers typically surface only the failing ones.
 */
export function checkAppearanceContrast(
  colors: Parameters<typeof appearanceContrastPairs>[0],
  onAccent: string,
): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const pair of appearanceContrastPairs(colors, onAccent)) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    if (ratio === null) continue;
    results.push({ ...pair, ratio, passesAA: ratio >= WCAG_AA_NORMAL });
  }
  return results;
}
