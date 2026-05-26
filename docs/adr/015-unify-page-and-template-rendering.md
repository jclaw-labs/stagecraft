# ADR-015: Unify page and template rendering on one collection-view renderer

## Status
Accepted

## Context
musician-site has **two render paths and two implementations of the same
"show a collection" block** — a duality ADR-009 introduced on purpose (its
template stack shipped as code, though ADR-009's own status still reads
*Proposed*) that has since calcified into avoidable duplication.

- **Template path (ADR-009 §4–§5).** Collection *detail* / *item* pages render
  through the template walker (`resolveTemplate`) + `buildTemplatePuckConfig`.
  Its generic **Collection block**
  (`src/lib/collections/template/collection-block.tsx`) iterates a source
  collection's items with authored **filter / sort / limit**, rendering each
  item via the collection's `itemTemplate`, a per-slug **specialised renderer**
  (`specialisedRendererFor` — `photos`, `videos` today), or a default
  field-stack. `blockNameForCollection("tour-dates")` yields **`TourDatesView`**.
- **Page path (ADR-009 §5 "page-system variant", ADR-007 §3).** Hand-authored
  pages render through Puck's `<Render config={puckConfig}>` with **pure
  literal-prop blocks**. Collection data is injected by a separate server pass,
  `resolvePageCollectionBlocks`, into **bespoke** React blocks — `TourDatesView`
  / `ReleasesView` / `PostsView` (`src/puck/config.tsx`) — each hand-written for
  one collection.

So `TourDatesView` exists **twice** (once per Puck config), and every
page-embeddable collection view is bespoke React (the work that shipped Releases
and Posts). The page path was kept "pure, no walker" precisely to dodge two
capabilities the template data model lacks:

1. **Value formatting.** Bindables resolve a field to its *raw* string
   (`resolveStringBindable`); there's no date→year/weekday or select→label
   formatting. The bespoke views hardcode it (`Album · 2026`, `Sat · Aug 1`,
   `May 10, 2026`).
2. **Dynamic filters.** `filterSchema` values are `literal` or
   `currentItem`-derived — no "now/today". `TourDatesView`'s upcoming-only
   (`date ≥ today`) + drop-cancelled rules can't be expressed declaratively.

The result: a parallel page render path (`renderPage` vs
`renderCollectionItemDetail` in the `[[...slug]]` catch-all), duplicated block
names, and a per-collection-bespoke ceiling — an artist-created collection
can't be placed on a page at all, since the resolve pass is hardcoded to the
three prebaked slugs (`tour-dates`, `releases`, `posts`).

## Decision
Converge the two paths: **render hand-authored pages through the template
renderer**, making the existing generic Collection block the *single*
collection-view implementation across pages and templates. Retire the bespoke
page blocks and `resolvePageCollectionBlocks`, and close the two capability gaps
so the data-driven block does what the bespoke ones did.

This supersedes the "pure literal-prop page blocks / no walker" stance of
ADR-007 §3 and the ADR-009 §5 page-system variant **for collection data** —
page *chrome* blocks stay pure; collection embedding moves to the walker.

Consumers-first, deletion-last (mirrors ADR-014):

1. **Bindable value formatting (enabling feature).** Add an optional `format` to
   string Bindables: date presets (`year` / `weekday-day` / `full`, UTC) and
   select-option-label resolution. Lands in `binding.ts` + the `Text` / `Button`
   primitives. Independent and unit-testable.
2. **Relative-date filter values (enabling feature).** Add a `today`-relative
   `FilterValue` kind (and select `neq` if absent) to `filterSchema` /
   `applyFilter`, so "upcoming" and "exclude cancelled" become declarative.
   Independent and unit-testable.
3. **Unified block palette.** The page editor's chrome blocks (Section, Columns,
   FullscreenSection, Gallery, ImageCarousel, Card, ContactForm,
   NewsletterSignup, Quote, Embed, …) must exist in the template config. Port
   the page-only blocks into the primitive registry, or build the page config as
   `primitives ∪ page-chrome ∪ collection-blocks`. This is the bulk of the work
   (the template primitive set is currently the smaller Section/Stack/Text/
   Image/Button/Link/RichText).
4. **Seed the three views.** Author `releases` / `posts` as `itemTemplate`s using
   feature #1; keep `tour-dates` as a **specialised renderer** — its list
   layout, Tickets CTA, and disabled state read clearer in React (the same call
   `photos` / `videos` already make). Its upcoming / exclude-cancelled rules
   apply at the Collection-block level via feature #2, feeding the specialised
   renderer a pre-filtered item set (specialised renderers receive only
   `{ item }`, so the filter can't live inside them).
5. **Render-path convergence + content migration.** Point the catch-all's
   `renderPage` at `buildTemplatePuckConfig` + the Collection-block registry +
   the walker, threading the page as its own `currentItem` (built via the
   existing `pageDataToItem`). This *realises* the page-as-item model ADR-009 §2
   only **proposed** — today `renderPage` passes raw Puck `Data` and never
   constructs an Item. Because the walker resolves `content` only, this step
   must also preserve the **root-props surface** `renderPage` owns and the
   template model has no slot for: `isSplashPage` / `isFooterHidden` /
   `pageBackground` / `pageBackgroundOverlay`, plus the `generateMetadata`
   title/description. Switch the page editor (`Editor.tsx`) to the unified
   config. Migrate committed page JSON + first-run seeds: a bespoke
   `TourDatesView {limit}` becomes a Collection block
   `{ sourceCollection, limit, sort, filter }`.
6. **Delete** the bespoke collection blocks in `src/puck/config.tsx` and
   `resolve-page-collections.ts` once 1–5 land. The `TourDatesView` name
   collision resolves by deletion.

Outcome: any collection — including artist-created ones — becomes embeddable on
a page (closing the gap ADR-009 left open), views are artist-editable via the
existing template editor, and `format` + relative filters become general
capabilities usable on detail templates too.

## Consequences
- **One collection-view implementation, one render path.** No more parallel
  `renderPage`; the catch-all dispatches everything through the walker. Pages
  can embed *any* collection (incl. `photos` / `videos`, impossible today).
- **Artist-authorable views.** A new collection gets a real on-page view by
  authoring an `itemTemplate` (or accepting the default card) — no developer
  change. This delivers the generic "CollectionView" capability by reusing the
  template machinery rather than a parallel block.
- **Two new general renderer features.** `format` Bindables and relative-date
  filters also benefit detail/item templates.
- **Bespoke React shrinks to the specialised-renderer registry.** `tour-dates`
  (and any future formatting/filter-heavy view) lives in `specialized-views.tsx`
  beside `photos` / `videos` — one well-named home, consulted by the single
  Collection block.
- **Root-level page settings + SEO stay outside the template model.** The walker
  resolves `content` only, so the splash/footer/background root props and the
  document title/description (`generateMetadata`) remain owned by the converged
  `renderPage`, not turned into blocks — the convergence wraps the walker, it
  doesn't replace this surface. (Cycle safety is unaffected: a page-embedded
  Collection block is the `detailTemplate` analog, and items still render via
  Primitives-only itemTemplates — ADR-009 §4.3 — but pages do shift from the
  "Collection-blocks-stripped-from-`puckContent`" regime to the detailTemplate
  regime, and every page request now runs the walker's async collection
  pre-load, bounded by a short-circuit when a page embeds no Collection block.)
- **Migration cost + risk.** Committed page bodies and first-run seeds change
  block shape; needs a one-shot page-JSON migration with tests. The catch-all
  render-path merge and the block-palette port are the risky pieces — every page
  block must render identically under the walker.
- **Reverses an ADR-007 §3 choice.** Pages adopt the walker/Bindable model for
  collection data; the "pure blocks" simplicity is traded for one unified
  system. Page *chrome* blocks stay pure.
- **Already-deployed sites unaffected** (each is an independent repo copy,
  ADR-007 / ADR-008); they rebuild from their own checked-in template.

## Rejected alternatives
- **Fork A — page-side specialised registry.** Collapse the three bespoke blocks
  into one configurable page block plus a page-side per-slug renderer registry,
  keeping the page path separate. Lower risk, but *preserves* both render paths
  and the duplicate `TourDatesView`, and doesn't make collection views
  artist-authorable. A reasonable interim; it entrenches the duality this ADR
  removes.
- **Config-driven view descriptor.** A declarative per-collection "view config"
  (layout / field-roles / filter / sort / cta) interpreted by one renderer.
  Rejected: it reinvents `itemTemplate` + filters + specialised renderers, which
  already exist — a third model, not a unification.
- **Status quo.** Two systems, a hand-written bespoke block per collection.
  Rejected: per-collection developer cost forever, and artist-created
  collections can never appear on a page.
