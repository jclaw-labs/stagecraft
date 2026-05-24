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

## Resolved
<!-- move items here once handled, with the PR/commit that did it -->
