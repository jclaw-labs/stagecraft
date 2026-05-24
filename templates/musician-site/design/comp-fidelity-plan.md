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
- **PR C (Phase 3) — layout flexibility + menubar.** The blocks render the right
  content but are too rigid, and the spacing/scale don't match the comps' density.
  Make components flexible:
  - ~~**Buttons in a row.**~~ DONE (Phase 4) — `ButtonRow` block (inline,
    wrapping group of CTAs).
  - ~~**Hero scale.**~~ DONE (Phase 3) — wired heading `font-size` off
    `--scale-display`; hero `h1` uses the display font.
  - ~~**Card chrome.**~~ DONE (Phase 4) — `Section` `variant: "card"`
    (theme-aware surface + border + radius + shadow); release uses it.
  - **Density.** Tighten Section padding — comps are denser; sections currently
    float in voids. (`--section-space` is a dead token — wire or remove it.)
  - **Column alignment.** `Columns` is fixed-ratio + top-aligned; add vertical
    alignment so album-vs-text balances.
  - Plus the deferred token wiring: `buttonFill`, `ruleStyle`, `imageTreatment`,
    `galleryLayout`, `accentMode: gradient` backgrounds.

  **Menubar / header** (examined — `src/components/Header.tsx`):
  - **Sparse nav** — the seed makes one page, so the navbar shows only "Home"
    while comps show full navs. *Smart fix (not literal):* seed a few real starter
    pages (About / Music / Contact) with light content so the nav is genuine and
    full — no fake/dead links.
  - ~~**Transparent-header overlap.**~~ DONE (Phase 3) — non-sticky headers are
    now `relative` (normal flow), so they never overlap/hide content.
  - **`logo-center-nav-split` is a no-op** (collapses to nav-below per its own
    comment). Implement a real left·logo·right split or drop the option — don't
    ship a misleading setting.
  - Nav-link presence (tracking/weight tied to theme) + a mobile menu once the
    nav has several items.

  *Principle: don't blindly match the comps — where a comp choice looks
  unintentional (fake nav, overlap artifact), do the correct thing instead.*

## Deferred (architectural)

- **Collection-data blocks on general pages.** A real tour-date / release list
  embedded on the Home (or any hand-authored) page needs the collection-block +
  template-renderer system bridged into the page `puckConfig` and the `(public)`
  page server component (async item pre-load). CLAUDE.md lists this under "what's
  intentionally not here yet"; it's a sizable cross-system change. The seed's
  composed tour rows + tracklist are the stand-in until then.
