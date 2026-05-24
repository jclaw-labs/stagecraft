# Deferred / remembered items — tokenized theming work

Running log of things consciously **not** addressed in the PR where they came
up, so they aren't lost. Each notes why and where it should land.

## Open

- **Interim presets superseded.** The first foundation PR adds `lantern` +
  `meadow/riot/paper/aurora/vinyl` as simple (color/type/header-only) presets.
  The tokenized system (plan PR4) rebuilds **all** presets as the full 17
  design-token bundles and drops `classic/midnight/marquee/lantern`. The
  simple ones are an intentional stepping stone; expect churn in PR4.
- **Curated Google Fonts picker.** Appearance takes free-text font names today.
  A curated category→family picker (legacy template had one) is plan PR5 polish,
  not v1.
- **Preset preview thumbnails + contrast/a11y guardrails.** Plan PR5 polish.
- **Decorative motifs** (Cobalt Blue-Note circle, any record motif) — out of
  scope for the tokenized system; would be future decorative blocks if wanted.
- **Comp PNGs** are git-ignored (regenerable via `render.mjs`); only HTML +
  index + plan are tracked. Intentional, to keep the repo lean.

## Open (from PR1 review)

- **Design var naming.** PR1 emits `--radius-theme` / `--shadow-theme` /
  `--section-space` etc. with distinct names so they don't clobber the static
  `globals.css` tokens (keeps PR1 zero-visual-change). PR2 reconciles: either
  blocks read the `-theme` vars, or `globals.css` defaults get overridden under
  `.stagecraft-site`. Pick one consistent scheme in PR2.
- **Artist color/gradient strings → inline `<style>`.** `onAccent` +
  `accentGradient.{from,via,to}` are interpolated into the emitted CSS, same as
  the existing `--color-*` interpolation already on main. The artist owns their
  own auth-gated site, so this isn't a privilege boundary; left as-is to match
  the existing trust model. Revisit only if appearance becomes cross-tenant.

## Open (from PR3)

- **Header chrome admin.** `headerHeight` / `headerBorder` are consumed by
  Header (PR2) and editable values exist, but the `/admin/navigation` form +
  header-item persistence for them aren't wired yet. Fold into PR4 (presets set
  these via an extended `HeaderStyle`, so PR4 adds header persistence) or PR5.
- **`design` JSON field in the generic editor.** Stored as one systemLocked
  JSON text field; the custom Appearance panel is the real editor. The generic
  collection editor would show raw JSON — acceptable since appearance has a
  custom surface. A dedicated object/group field type could come later.
- **Admin "Advanced" disclosure.** PR3 groups the controls into FieldGroups
  (Layout / Shape / Detail) but doesn't collapse them behind an Advanced toggle.
  Collapsible disclosure is PR5 polish.

## Open (from PR4)

- ~~Remaining 10 presets~~ — **done in PR4b** (ink, ember, redwood, mahogany,
  oak, pulse, concrete, candy, obsidian, cobalt). All 15 directions now ship as
  `THEME_PRESETS` entries.
- **Unwired design tokens (consumer completion).** `buttonShape` (`--btn-radius`)
  and `grain` are now wired (PR5). Still emitted + persisted + preset-set but not
  yet consumed by blocks: `buttonFill` (solid/outline/underline), `ruleStyle`
  (Divider), `imageTreatment` (framed/rounded on Image), `galleryLayout`
  (masonry/portrait), `headingScale` (heading font-size), and `accentMode:
  gradient` backgrounds. These remaining ones need `design` threaded into the
  pure Puck blocks (a larger consumer pass) for full comp fidelity. Colors,
  fonts, density, content width, radius, shadow, heading case/tracking, footer
  style, header mode/layout/uppercase, button shape, and grain already render.
- **`classic`/`midnight`/`marquee` removed** from `THEME_IDS`; `DEFAULT_THEME_ID`
  is now `meadow`. (`lantern` from the foundation PR also dropped.)

## Resolved
<!-- move items here once handled, with the PR/commit that did it -->

- **Welcome wizard tests hardcoded to dropped presets** — #243's welcome unit +
  e2e specs asserted `classic`/`midnight`/`marquee` literally and were red on
  `main` after the squash; reworked to derive from `THEME_IDS`/`THEME_PRESETS`
  (PR4, #248).
