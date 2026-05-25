"use client";

import type { CSSProperties } from "react";

import { buildFontStack } from "@/lib/google-fonts";
import type { ThemePreset } from "@/lib/theme-presets";

/**
 * Miniature mock of a theme preset for the welcome picker: the preset's real
 * palette (background → surface card → heading + body text + an accent button)
 * plus its typographic character. The preset webfonts aren't loaded in the
 * wizard, so `buildFontStack` supplies the right CSS generic (serif / sans /
 * mono / cursive) — enough to read serif-vs-sans at a glance.
 *
 * Preset hex values are *data* (the thing being previewed) so they're set
 * inline; everything else (sizing, spacing, radius, weight) uses design tokens.
 */
export function ThemeThumbnail({ preset }: { preset: ThemePreset }) {
  const { colors, typography } = preset.appearance;
  const headingFamily =
    typography.headingMode === "split" && typography.headingFont.length > 0
      ? typography.headingFont
      : typography.bodyFont;
  const headingStack = buildFontStack(headingFamily) || "var(--font-body)";
  const bodyStack = buildFontStack(typography.bodyFont) || "var(--font-body)";
  const onAccentRaw = preset.appearance.design?.onAccent ?? "";
  const onAccent = onAccentRaw.trim().length > 0 ? onAccentRaw : colors.surface;

  const frame: CSSProperties = {
    display: "block",
    background: colors.background,
    border: `1px solid ${colors.border}`,
    borderRadius: "var(--radius-sm)",
    padding: "var(--space-2)",
    overflow: "hidden",
  };
  const card: CSSProperties = {
    display: "block",
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: "var(--radius-sm)",
    padding: "var(--space-2)",
  };

  return (
    <span aria-hidden="true" style={frame}>
      <span style={card}>
        <span
          style={{
            display: "block",
            fontFamily: headingStack,
            color: colors.text,
            fontWeight: "var(--font-weight-semibold)" as unknown as number,
            fontSize: "var(--font-size-sm)",
          }}
        >
          Aa
        </span>
        <span
          style={{
            display: "block",
            marginTop: "var(--space-1)",
            fontFamily: bodyStack,
            color: colors.textMuted,
            fontSize: "var(--font-size-xs)",
          }}
        >
          Quick brown fox
        </span>
        <span
          style={{
            display: "inline-block",
            marginTop: "var(--space-2)",
            background: colors.accent,
            color: onAccent,
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-1) var(--space-2)",
            fontSize: "var(--font-size-xs)",
            fontFamily: bodyStack,
          }}
        >
          Listen
        </span>
      </span>
    </span>
  );
}
