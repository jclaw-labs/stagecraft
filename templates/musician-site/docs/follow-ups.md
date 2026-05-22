# Musician-site follow-ups

Items intentionally deferred during the parity-restoration sweep
(March-May 2026). Captured here so they don't get lost between PRs —
each section names the originating PR + the reasoning behind the
defer.

This is a living document; add to it when a deep-review surfaces
something worth fixing that doesn't fit the current PR's scope.

## Photo lightbox

- **Touch swipe gestures.** Mobile users currently navigate via the
  arrow buttons (44×44 tap targets) or the close-to-cycle gestures
  the browser provides on `<img>` swipes (none). The standard touch
  UX is swipe-left-to-advance / swipe-right-to-go-back. Needs
  pointer-event handling with `touchstart`/`touchmove`/`touchend`
  delta + threshold logic, or a `usePan` hook abstraction. From #183.
- **Pinch-zoom for high-DPR viewing.** Lightbox currently caps the
  image at `max-height: calc(100vh - var(--space-32))`; pinch-zoom
  on touch screens would let users inspect detail. Browser native
  pinch-zoom on the page is suppressed by the body-scroll-lock; we'd
  need an explicit transform-based zoom inside the modal. From #183.
- **MutationObserver re-scan for dynamic galleries.** Boot attaches
  click delegation once on mount. Galleries inserted after hydration
  (the gallery editor's preview pane, future client-side filters)
  wouldn't get handlers. The public site doesn't do dynamic
  insertions today, so this is acceptable. From #183.

## Newsletter signup

- **Inspector validation hints.** When `service: mailchimp` is
  selected but the `actionUrl` lacks `u` / `id` query params, the
  `parseMailchimpAudienceHoneypotName` falls back to null (no
  honeypot emitted) and the artist gets no signal. A Puck inspector
  warning ("This URL doesn't look like a Mailchimp embed URL —
  expected `?u=USER_ID&id=LIST_ID`") would catch the mistake at
  authoring time. From #181.
- **Generic "additional fields" array.** Today `hasNameField`
  toggles a single first-name input. Artists may want phone, country,
  or a custom field. An `additionalFields: { label, name, type }[]`
  array would generalise; for v1 the name field covered the most-
  common ask. From #181.

## Card

- **`minimal` variant + `size` axis.** v2 ships with `filled` /
  `outlined` and a single size. The legacy template adds a
  `minimal` variant (no border, no padding — list-item-scale) and
  a `size: sm / md / lg` axis. Skipped pending demand. From #187.
- **Icon-mode media for non-image previews.** Audio / video / PDF
  files render as generic icons in the legacy template via the
  `mediaKind` inference. The new template's Card only supports
  image previews. Audio / video / PDF tiles are useful for press-
  kit / download list use cases. From #187.

## SVG handling

- **Sanitisation telemetry.** `DOMPurify.sanitize` exposes
  `DOMPurify.removed[]` after each pass — logging when removals
  occur would surface "your SVG was modified" to admins, useful for
  debugging "why did my drop-shadow disappear" support questions.
  From #182.
- **`Cache-Control: no-transform` on SVG responses.** Some CDNs
  optimise SVG bytes (inline-data URIs, strip XML declarations,
  rewrite namespaces). `no-transform` forbids that. Speculative —
  not a known issue today — but a small additional header on the
  already-locked SVG rule. From SVG-Content-Disposition review.

## Carousel

- **Touch-swipe nav on the carousel.** The track scrolls natively
  (scroll-snap), but the dot indicators don't get swipe-to-cycle
  semantics. Native scroll handles this on mobile, so it's already
  good; the gap is desktop trackpad swipe → cycle button presses.
  Low priority. From #171.

## Routing / publish

- **Per-page background overlay opacity.** Site-level `pageBackground`
  + per-page override both ship; the legacy template also had a
  `pageBackgroundOverlay` opacity tint (so dark backgrounds can host
  light text). Could add as a Puck root field once the use case
  shows up. From #179.

## Drawer search + categories

- **Short-circuit the visibility dispatch when no filter is active.**
  `DrawerCategoryVisibilitySync` currently dispatches `setUi` on every
  mount and every filter change, even when `filter === ""` (the
  branch where every category resolves to `visible: true` — a no-op
  against Puck's initialisation). An early return on empty filter
  would save one dispatch per drawer mount and per filter clear. Pure
  perf nit; the unconditional path is correct and cheap. From #189
  deep review.
- **`Media` category split as it grows.** Currently holds Image,
  ImageCarousel, Embed, EmbedResponsive (visuals + iframes mixed).
  As ADR-009 collection blocks land (`<TourDatesList>`,
  `<ReleasesGrid>` etc.), this bucket will swell. Worth splitting
  into `Images` + `Embeds` if the count crosses ~8. From #173 deep
  review.
- **Regression test for the drawer-filter category sync.** The
  expanded-preservation + recordHistory:false fix shipped in #189
  without a unit test — driving Puck's reducer is heavy and we
  verified manually instead. Could be testable if the `(filter,
  categories) → visibility-map` reduction is extracted into a pure
  helper. From #189 deep review.
