import type { CSSProperties } from "react";

/**
 * Shared button styling for both render paths — the page-editor blocks
 * (`src/puck/config.tsx`) and the collection-template renderer
 * (`src/lib/collections/template/primitives.tsx`). One source so the two
 * can't drift. Pure values only (no node imports) → safe for the client
 * bundle and the pure template renderer.
 *
 * Theme-aware: AppearanceStyles emits `--btn-*` tokens from the artist's
 * button-fill / button-shape choices; each falls back to a solid accent
 * button when no theme is active (e.g. the editor canvas).
 */
export const BUTTON_VARIANTS = ["primary", "secondary", "outline"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_BASE: CSSProperties = {
  display: "inline-block",
  padding: "var(--space-2) var(--space-4)",
  // Theme button shape (square / rounded / pill); falls back to the corner radius.
  borderRadius: "var(--btn-radius, var(--radius))",
  textDecoration: "none",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  cursor: "pointer",
};

export const BUTTON_VARIANT_STYLE: Record<ButtonVariant, CSSProperties> = {
  primary: {
    // Theme button fill (solid / outline / underline) via --btn-* vars,
    // falling back to a solid accent button.
    background: "var(--btn-bg, var(--color-action))",
    color: "var(--btn-fg, var(--color-action-fg))",
    border: "var(--border-width) solid var(--btn-border, var(--color-action))",
    textDecoration: "var(--btn-decoration, none)",
  },
  secondary: {
    background: "var(--color-surface-raised)",
    color: "var(--color-text)",
    border: "var(--border-width) solid var(--color-surface-raised)",
  },
  outline: {
    background: "transparent",
    color: "var(--color-text)",
    border: "var(--border-width) solid var(--color-text)",
  },
};
