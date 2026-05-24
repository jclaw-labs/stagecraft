# Comp-fidelity plan — make the rendered themes look like the comps

The tokenized theming work (PRs #244–#251) shipped the **presets** (palette,
type, design tokens) but the rendered first-run site is a near-empty placeholder
— so the public site (and the PR screenshots) look nothing like the comps in
`design/theme-comps/`. The comps depict a fully populated artist site; the seed
only places Heading/RichText/Section.

## Gap (comp → rendered)

- **Hero**: eyebrow + oversized display headline + subtitle + CTA button + hero
  image → rendered: an `<h1>` + a paragraph. No eyebrow, button, or image.
- **Imagery** (hero banner, album art, 3-tile gallery) → **none**: seed places no
  `Image` blocks, and no demo image assets ship.
- **Buttons** (Listen / Stream / Order vinyl / Tickets) → none.
- **Latest-release card** (art + title + blurb + buttons) → a "add an image" note.
- **Tour list** with per-row Tickets buttons → a placeholder paragraph;
  `TourDatesView` isn't even registerable on a general page.
- **Gallery grid** (3-up) → nothing.
- **Layout variety / two-column** → single centered column of text.
- **Section eyebrows** → plain headings.
- **Footer socials** → bare copyright (Footer renders socials, but none seeded).
- **Per-theme character** (button shape/fill, gradients, image treatment, grain)
  → barely visible because the page is empty.

## Approach: theme-adaptive gradient placeholders (no shipped binaries)

Rather than ship per-theme image binaries (15× sets), the `Image` (and
`FullscreenSection`) blocks render a **themed gradient** in their empty state,
sized to an aspect ratio. The seed places image blocks with no upload → they
render as comp-style gradient banners/tiles that adapt to each preset's palette
via `--gradient-accent` / `--color-*`, and are replaced in place when the artist
uploads a real photo. This doubles as a better empty-state UX everywhere.

## PRs

- **PR A (Phase 1) — rich seed + gradient placeholders.** Gradient empty-state +
  `aspectRatio`/`tone` on `Image`; gradient hero on `FullscreenSection`. Rewrite
  `buildFirstRunSeed` + regenerate `content/.../home.json` to a comp-faithful
  Home: hero (FullscreenSection) → latest-release (Columns: album + text + 2
  buttons) → gallery (Columns 3-up of Images) → tour placeholder → seed social
  links. Re-screenshot. *Biggest visual win.*
- **PR B (Phase 2a) — close block gaps.** Register `TourDatesView` (+ a
  release/tracklist view) in the page editor's `puckConfig`; seed demo tour
  dates + a release so the Home renders a real dated list with Tickets buttons +
  a tracklist. Add a responsive Gallery-grid block + an eyebrow text style.
- **PR C (Phase 2b) — finish token wiring.** Thread `design` into the pure Puck
  blocks: `buttonFill`, `ruleStyle`, `imageTreatment` (framed/rounded art),
  `galleryLayout`, `headingScale`, `accentMode: gradient` backgrounds. (Clears
  the DEFERRED.md "unwired tokens" item — themes finally look distinct.)
- **PR D (Phase 3) — per-theme fidelity + screenshots.** Walk each of the 15
  presets against its comp; adjust tokens where they diverge; regenerate all 15
  marketing/PR captures from the populated seed.
