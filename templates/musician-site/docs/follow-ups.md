# Musician-site follow-ups

Items intentionally deferred during the parity-restoration sweep
(March-May 2026). Captured here so they don't get lost between PRs —
each section names the originating PR + the reasoning behind the
defer.

This is a living document; add to it when a deep-review surfaces
something worth fixing that doesn't fit the current PR's scope.

## Photo lightbox

- **Pinch-zoom for high-DPR viewing.** Lightbox currently caps the
  image at `max-height: calc(100vh - var(--space-32))`; pinch-zoom
  on touch screens would let users inspect detail. Browser native
  pinch-zoom on the page is suppressed by the body-scroll-lock; we'd
  need an explicit transform-based zoom inside the modal. From #183.

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

- **Surface sanitisation removals in the upload response.** The
  sanitiser already logs to `console.warn` when DOMPurify strips
  content (admin-visible in Vercel / Netlify function logs). The
  next step is to return the removal summary alongside the buffer
  so the upload route can include it in the API response — the
  picker UI could then surface a hint inline ("we stripped 2 items
  from your SVG: `<script>`, `onclick=`"). Needs an API change to
  `sanitiseSvg` to return `{ buffer, removed }` and a small UI
  affordance in `ImagePickerField`. From svg-hardening-bundle PR.

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
