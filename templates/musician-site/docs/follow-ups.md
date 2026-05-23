# Musician-site follow-ups

Items intentionally deferred during the parity-restoration sweep
(March-May 2026). Captured here so they don't get lost between PRs —
each section names the originating PR + the reasoning behind the
defer.

This is a living document; add to it when a deep-review surfaces
something worth fixing that doesn't fit the current PR's scope.

## Photo lightbox

- **Double-tap + desktop zoom controls.** Pinch-to-zoom ships for
  touch (two-finger pinch + one-finger pan when zoomed), but there's
  no zoom affordance for mouse/trackpad users — they have the full
  lightbox-size variant already, but a double-tap-to-toggle gesture
  and/or +/− buttons would round it out (double-tap also helps on
  touch where a precise pinch is awkward). The gesture pipeline +
  `ZoomState` are in place; this is additive. From lightbox-pinch-
  zoom PR.
- **iOS edge-swipe-back conflict.** A right-swipe starting near the
  left edge of the screen can trigger iOS Safari's system-level
  back-navigation instead of cycling to the previous photo. The
  pinch-zoom PR moved the touch listeners to native non-passive
  `addEventListener` (so `preventDefault` now works) and set
  `touch-action: none` on the overlay, which should suppress most
  of this — but the system edge gesture can still win from the very
  screen edge. Remaining fix: `preventDefault()` on a swipe-start
  within ~20px of the viewport edge. Defer until artists report it.
  From lightbox-touch-swipe PR review.
- **Multi-touch palm-grazing interrupts a swipe.** If a second
  finger lands mid-swipe, the gesture switches to pinch and the
  original one-finger swipe is abandoned; when the extra finger
  lifts, the remaining finger doesn't re-arm a swipe until a fresh
  touchstart. Two-finger phone use surfaces this occasionally. Fix
  would track the primary touch's `identifier` and resume the
  single-finger gesture when the touch count drops back to one.
  From lightbox-touch-swipe PR review.

## Newsletter signup

- **Per-service URL validation patterns.** The inspector hint
  added in the Mailchimp validation PR only covers Mailchimp's
  `?u=USER_ID&id=LIST_ID` shape; Buttondown / ConvertKit / generic
  silently fall through to a paste hint. Each has its own URL
  pattern (e.g. Buttondown's
  `buttondown.email/api/emails/embed-subscribe/<slug>`), and a
  per-service parser + matching hint would extend the same author-
  time signal. Defer until artists ask. From newsletter-validation
  PR review.
- **Inspector warning when an additional field name collides.** The
  renderer silently drops an additional field whose `name` matches a
  reserved form field (`_gotcha`, the per-service email / name
  attribute, the Mailchimp `b_*` honeypot) to avoid emitting a
  duplicate `name=` input that breaks submission. The drop is safe
  but invisible — an artist who names a field `EMAIL` just sees it
  not appear. A Puck inspector hint ("this name is reserved — the
  field won't be added") would close the loop, mirroring the
  `actionUrl` validation hint. From newsletter-additional-fields PR
  review.

## Card

- **Inline audio / video players in the Card media slot.** The
  icon-mode media tiles (audio / video / PDF / file glyphs) render
  non-interactively so they're valid inside a link-card's `<a>`
  wrapper. The legacy template renders audio / video `fileUrl`s as
  actual `<audio controls>` / `<video controls>` players. For non-
  link cards (where interactive content is valid), we could upgrade
  the audio / video tiles to inline players. Gated on: detecting the
  non-link case at render and swapping the glyph tile for a player.
  From card-icon-media PR.
- **Hover affordance on `minimal` cards.** A `minimal` link/hoverable
  card shares the `.stagecraft-card-link:hover` rule, which applies
  `box-shadow: var(--shadow-md)` + a lift on hover. The lift reads
  as a fine clickability cue, but the drop-shadow on a chrome-less
  card (no border, no surface) floats around the content bounding
  box, which can look slightly detached from the "bare list-item"
  resting intent. The `border-color` shift in the same rule is a
  no-op (minimal has no `border-style`), so there's no visible
  border bug — only the shadow is debatable. A `minimal`-specific
  hover rule that drops the shadow (keeping the lift) would tidy
  this; it's a cosmetic judgment call, deferred. From card-minimal-
  size PR review.


## Carousel

- **Touch-swipe nav on the carousel.** The track scrolls natively
  (scroll-snap), but the dot indicators don't get swipe-to-cycle
  semantics. Native scroll handles this on mobile, so it's already
  good; the gap is desktop trackpad swipe → cycle button presses.
  Low priority. From #171.

## Drawer search + categories

- **`Media` category split as it grows.** Currently holds Image,
  ImageCarousel, Embed, EmbedResponsive (visuals + iframes mixed).
  As ADR-009 collection blocks land (`<TourDatesList>`,
  `<ReleasesGrid>` etc.), this bucket will swell. Worth splitting
  into `Images` + `Embeds` if the count crosses ~8. From #173 deep
  review.

## Puck inspector

- **Cleaner null state on per-page `pageBackgroundOverlay`.** The
  field's default is `null` (= "inherit site default"); the artist
  can override with a number 0..1. Puck's `type: "number"` field
  doesn't cleanly distinguish "empty / cleared" from "0" — the
  serialised value may end up `0` (which `extractPageRootProps`
  treats as "explicit no-tint override") instead of `null`. Runtime
  is safe via the validator; UX is the wrinkle. Options: pair the
  number field with an "Inherit site default" radio; or accept the
  v1 contract that 0 = no tint here, null = inherit (works when
  Puck preserves null). From pageBackgroundOverlay PR.
