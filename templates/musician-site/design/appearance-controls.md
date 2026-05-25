# Appearance controls: fonts, contrast, theme previews

## Curated font picker
`FontPickerField` (`src/app/admin/appearance/`) pairs a category select with a
family select, backed by the node-import-free `src/lib/google-fonts.ts`
(curated families per category + `buildFontStack` for CSS-generic fallbacks).
A **Custom** category is a free-text escape hatch for any Google Font; the
optional fonts (heading, display) add a **None / inherit** choice. Only the
family string is persisted — the category is derived from it via
`fontCategoryForFamily`, so the Zod typography shape is unchanged.

## Contrast guardrail
`src/lib/contrast.ts` (sRGB relative luminance + WCAG ratio, node-import-free)
powers a non-blocking advisory in the Appearance “Colors” group: it lists the
legibility-critical pairs that fall below AA (4.5:1). The button-label pair
tracks `buttonFill` — a solid button checks the on-accent label against the
accent fill; outline / underline buttons render the label in accent over the
page background, so that's the pair checked. It's a visual advisory (not an
aria-live region) so it doesn't announce on every colour keystroke.

## Theme thumbnails
`ThemeThumbnail` (welcome wizard) previews each preset's palette + type in a
mini mock (background → surface card → heading + body line + accent button).
The preset webfonts aren't loaded in the wizard, so `buildFontStack`'s CSS
generic (serif / sans / mono / cursive) is what conveys the typographic
character at a glance.
