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

## Resolved
<!-- move items here once handled, with the PR/commit that did it -->
