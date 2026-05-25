# Collection blocks on general pages

Two page-editor blocks read live collection / theme data at render time, while
staying pure (they only ever receive literal props — no React context):

- **TourDatesView** — a data-bound tour list. The block holds only a `limit`;
  `resolvePageCollectionBlocks` (run in the public catch-all before `<Render>`)
  loads the `tour-dates` collection and injects the upcoming, non-cancelled
  items as an `items` prop, soonest first. In the editor `items` is undefined,
  so the block renders a placeholder instead of live data.

- **Gallery** — a tiled photo grid whose arrangement (grid / portrait /
  masonry) is theme-driven by the `galleryLayout` design token. The layout is
  a `globals.css` base (grid, also what the editor canvas shows) plus scoped
  `.stagecraft-site [data-gallery]` overrides emitted by `AppearanceStyles` for
  the portrait / masonry themes. Empty tiles fall back to the same themed
  gradient placeholder the Image block uses.

Data arrives as props (resolved server-side) and theme arrives via CSS custom
properties — neither block threads a `design`/context object, so both remain
trivially server-renderable through Puck's `<Render>`.
