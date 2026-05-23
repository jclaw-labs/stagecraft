/**
 * Welcome-wizard step ids + shape of the in-flight form values.
 *
 * Split out from the client component so tests can import the types and
 * the pure payload-builder without dragging in the React tree. The
 * order of `WELCOME_STEPS` is the order the artist walks; rearrange
 * here to reshuffle the flow.
 */

import type { ImageMetadata } from "@/lib/image-types";
import { DEFAULT_THEME_ID, THEME_IDS, type ThemeId } from "@/lib/theme-presets";

export const WELCOME_STEPS = ["name", "start", "wordmark", "firstPage"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

/**
 * What the artist picks on the "start" step: one of the curated themes,
 * a custom accent colour on the default palette, or a blank-but-themed
 * empty start. Derived from `THEME_IDS`, so a new preset shows up as a
 * choice for free.
 */
export const START_CHOICES = [...THEME_IDS, "custom", "empty"] as const;
export type StartChoice = (typeof START_CHOICES)[number];

export type WelcomeFormValues = {
  artistName: string;
  start: StartChoice;
  /** Only consulted when `start === "custom"`. */
  primaryColor: string;
  wordmark: ImageMetadata | null;
  firstPageTitle: string;
};

/**
 * Request body for POST /api/welcome/complete. `theme` is omitted for
 * the custom path (the route falls back to its accent-swap behaviour);
 * `seedContent` is false only for the "empty" start.
 */
export type WelcomeRequestBody = {
  artistName: string;
  primaryColor: string;
  wordmark: ImageMetadata | null;
  firstPageTitle: string;
  theme?: ThemeId;
  seedContent: boolean;
};

/**
 * Map the wizard's in-flight values to the request body. Pure, so the
 * start-choice → theme / seedContent mapping is unit-tested without the
 * React tree.
 */
export function buildWelcomePayload(values: WelcomeFormValues): WelcomeRequestBody {
  const base = {
    artistName: values.artistName.trim(),
    primaryColor: values.primaryColor.trim(),
    wordmark: values.wordmark,
    firstPageTitle: values.firstPageTitle.trim(),
  };
  switch (values.start) {
    case "custom":
      // Accent-only on the default palette: no theme, so the route swaps
      // the accent to `primaryColor` (its pre-theme behaviour).
      return { ...base, seedContent: true };
    case "empty":
      // Default theme, blank first page, nothing else seeded.
      return { ...base, theme: DEFAULT_THEME_ID, seedContent: false };
    default:
      // A named preset supplies the full palette + header style.
      return { ...base, theme: values.start, seedContent: true };
  }
}
