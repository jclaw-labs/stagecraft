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
- **PR B (Phase 2) — fidelity pass, no architecture (DONE).** Per the chosen
  "lighter" direction: an `Eyebrow` block (small uppercase accent label) used
  across the seed; richer per-theme placeholder gradients (built from the palette
  vars, so every preset's hero/gallery is multi-tone — fixes the flat
  Meadow/Obsidian heroes); a composed tour-list look (dated rows + Tickets CTAs,
  divided) and a tracklist in the release section; and a re-screenshot of all 15.
  A **real, data-bound** tour list on a general page (registering `TourDatesView`
  in the page `puckConfig` + pre-loading collection items in the public
  renderer) is the genuinely architectural piece CLAUDE.md defers — **left as a
  follow-up**, not done here.
- **PR C — finish token wiring.** Thread `design` into the pure Puck blocks:
  `buttonFill`, `ruleStyle`, `imageTreatment` (framed/rounded art),
  `galleryLayout`, `headingScale`, `accentMode: gradient` backgrounds. (Clears
  the DEFERRED.md "unwired tokens" item.)

## Deferred (architectural)

- **Collection-data blocks on general pages.** A real tour-date / release list
  embedded on the Home (or any hand-authored) page needs the collection-block +
  template-renderer system bridged into the page `puckConfig` and the `(public)`
  page server component (async item pre-load). CLAUDE.md lists this under "what's
  intentionally not here yet"; it's a sizable cross-system change. The seed's
  composed tour rows + tracklist are the stand-in until then.
