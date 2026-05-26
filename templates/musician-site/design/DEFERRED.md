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
- **Unwired design tokens (consumer completion).** Mostly DONE. `buttonShape` +
  `grain` (PR5); `headingScale` (Phase 3); and now `buttonFill` (primary button
  → `--btn-bg/-fg/-border/-decoration`), `imageTreatment` (Image → `--img-radius`
  + a framed mat via `--img-pad/-frame/-frame-bg`), `ruleStyle` (Divider →
  `--rule-width/-color`), and `accentMode: gradient` (a Section `accent` variant
  → `--gradient-accent`). **Only `galleryLayout` (grid/portrait/masonry) is still
  unwired** — it needs a dedicated Gallery block to apply to (the seed's gallery
  is a `Columns` of Images); tracked below.
- **Gallery block + `galleryLayout`.** A real gallery (grid/portrait/masonry)
  needs its own block that reads `galleryLayout`; the current 3-up gallery is a
  `Columns` of Image placeholders. Build a Gallery block, then wire the token.
- **`classic`/`midnight`/`marquee` removed** from `THEME_IDS`; `DEFAULT_THEME_ID`
  is now `meadow`. (`lantern` from the foundation PR also dropped.)

## Open (from the data-bound tour + Gallery PR — #1/#2 review)

- **Committed demo tour-dates bit-rot.** `src/content/collections/tour-dates/items/*.json`
  use hardcoded 2027 dates, so the *bundled* demo home (what a fresh clone / the
  dev server renders) will show the empty "No upcoming shows" state once those
  dates pass. The runtime welcome seed (`first-run-seeds.ts`) is relative-to-now
  and unaffected; only the committed demo degrades. No clean fix short of a
  build-time regenerator for committed demo content — accepted for now. Revisit
  if the bundled demo is used as a live showcase.
- **Editor can't preview non-grid gallery layouts.** The Puck editor canvas
  renders outside `.stagecraft-site`, so the scoped `portrait`/`masonry`
  overrides AppearanceStyles emits don't apply — the editor always shows the
  `grid` base. Acceptable (Appearance is a separate surface), but an artist on a
  masonry theme sees a grid while editing. A future fix could scope a preview
  wrapper into the editor.
- **Tour date display is UTC-only.** `TourDatesView.formatDate` (and the
  upcoming filter) work in UTC, matching the rest of the template's date
  handling. An evening show entered in a far-negative-offset zone can display the
  next UTC day. Consistent with existing convention; revisit if per-site
  timezone support lands.
- **"Upcoming" includes shows earlier today.** The filter keeps any show whose
  date is ≥ start-of-today (UTC), so a gig that already happened this morning
  still lists until UTC midnight. Intentional (a same-day show stays visible all
  day); noted so it isn't mistaken for a filter bug.

## Open (from the fonts / thumbnails / a11y PR — #3 review)

- **FontPickerField doesn't resync `category` to external `value` changes.** The
  picker holds the selected category in local state, initialised once from
  `value`. The Appearance form only ever changes the font via the field's own
  onChange, so it's correct today — but if an "apply a preset to Appearance" or
  a form-reset/undo flow ever rewrites `typography.*` externally, the category
  select would go stale. Add a resync (effect keyed on `value`, or a `key`) when
  that lands.
- **Border / non-text contrast not checked.** The contrast advisory covers
  text-on-surface pairs against WCAG AA (4.5:1). WCAG 1.4.11 sets a separate
  3:1 bar for non-text UI (borders, dividers, focus rings) — not evaluated.
  Low priority; revisit if borders become load-bearing for legibility.
- **Per-category font fallbacks in the live stack.** `buildFontStack` exists and
  the picker/thumbnail use it, but `AppearanceStyles` still emits the public
  `--font-*` stacks with a generic `system-ui, sans-serif` tail rather than the
  family's category generic — so a serif body briefly flashes sans during the
  webfont load. Wiring `buildFontStack` into AppearanceStyles would fix the FOUT
  character; deferred to keep this PR's render output unchanged.

## Open (from the data-bound Releases + Posts page blocks)

- **Collection-view cards don't link to detail pages.** `ReleasesView` and
  `PostsView` (and the home tour list) render non-interactive cards — they show
  the collection's items but don't link to each item's detail page
  (`/releases/<slug>`, `/news/<slug>`). Those detail routes already resolve via
  the public catch-all (falling back to the minimal `DefaultItemFieldsList`
  when the collection's `detailTemplate` is null), so an optional per-card link
  is a natural follow-on. Kept non-linking for v1 to match the original
  ReleasesView and because the null-`detailTemplate` fallback page is bare;
  revisit when releases/posts ship real detail templates.

## Open (from ADR-015 steps 1–2 — editor authoring of new renderer capabilities)

Both enabling features added a renderer/schema capability without the editor UI
to author it. The values are authorable by hand-editing JSON / in seeded
templates + Collection-block props (all steps 4–5 need); the editor controls
land when the editor unifies onto the template config (ADR-015 steps 3/5).

- **No editor UI to author a binding `format` yet (step 1).** The `format`
  directive (date presets + select→label) is in the renderer (`binding.ts` +
  primitives) and the Zod schema, but the template editor's binding picker has
  no control to set it. Add a format dropdown to the binding picker, shown only
  for date / select fields.
- **No editor UI to author/display the `today` filter value yet (step 2).** The
  `{ kind: "today" }` `FilterValue` resolves at render time, but
  `FilterValueEditor` (`FilterField.tsx`) has no "today (relative)" option in
  its value-kind toggle — and a seeded `today` value shows a blank kind select
  (no crash; if-chains, not an exhaustive switch). Add a `today` option to the
  toggle and a read-only display arm, alongside the binding-picker work above.

## Resolved
<!-- move items here once handled, with the PR/commit that did it -->

- **Curated Google-Fonts picker, preset thumbnails, contrast guardrails** — done
  (this PR): `FontPickerField` (category→family + Custom + inherit) replaces the
  free-text font inputs; `ThemeThumbnail` previews each preset in the welcome
  wizard; a `contrast.ts` WCAG util drives a non-blocking advisory in Appearance.
- **Gallery block + `galleryLayout`** — done (this PR): a Gallery block renders a
  tiled grid; `galleryLayout` (grid/portrait/masonry) is wired via a globals.css
  base + scoped `.stagecraft-site [data-gallery]` overrides from AppearanceStyles.
  The last unwired design token is now consumed.
- **Real data-bound collection block on general pages** — done (this PR): a
  `TourDatesView` page block + `resolvePageCollectionBlocks` server pass inject
  the live tour-dates collection into hand-authored pages; the home seed's faked
  tour rows + fake tracklist were removed.

- **Welcome wizard tests hardcoded to dropped presets** — #243's welcome unit +
  e2e specs asserted `classic`/`midnight`/`marquee` literally and were red on
  `main` after the squash; reworked to derive from `THEME_IDS`/`THEME_PRESETS`
  (PR4, #248).
