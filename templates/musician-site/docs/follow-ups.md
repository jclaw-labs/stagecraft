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

## Auth (editor allowlist)

- **Removing an editor doesn't revoke their live session.** The
  `ADMIN_EMAILS` allowlist gates *new* logins — the magic-link request
  plus a verify-time re-check — but `middleware.ts` and `getSession()`
  only validate the session JWT (signature / type / expiry), not live
  allowlist membership. So an editor dropped from the allowlist keeps
  `/admin` + API access until their `mc_session` cookie expires (≤7
  days). Immediate lock-out would need a per-request allowlist check in
  middleware (or a session epoch/version bumped on removal), kept off
  the hot path until an artist actually needs it. Also recorded in
  ADR-011 "Known limitations and deferred work". From #233 deep review.

## Test coverage

- **Tour-date seeding branch of `/api/welcome/complete`.** The route
  seeds two illustrative tour-dates when a `tour-dates` collection
  def exists and is empty. The new route tests cover the singleton +
  Home-page writes, the guards, and idempotency, but not the
  tour-date seed branch — exercising it needs the real `tour-dates`
  def registered in the test content dir AND seed values that pass
  `buildItemFileSchema` for that def (the seeds come from
  `buildFirstRunSeed`). Worth adding once a shared tour-dates fixture
  is wired into the route-test setup. From api-route-tests PR.

## Publish (per-item, ADR-012)

- **`squashBranchInto` has no stale-ref retry.** The full-publish path
  updates `main` with a plain `updateRef` (no retry, no expected-SHA
  guard), so two concurrent publishes to `main` — e.g. a full Publish
  racing a per-item Publish, or two editors publishing at once — aren't
  guaranteed to serialize; the loser can fail or clobber. Pre-existing
  (predates ADR-012); per-item Publish's `commitSelectedPathsInto` does
  retry. Give `squashBranchInto` the same `commitFiles`-style retry so
  both `main` writers serialize safely. *Trigger:* concurrent publishes
  observed in practice (more likely now multi-editor sites exist).

- **Per-item Publish reports a false failure when reconcile fails after
  the commit shipped.** If the subset commit to `main` succeeds (deploy
  fires) but the follow-up reconcile merge fails (transient error or a
  concurrent-edit conflict), `publishSelectedToMain` throws
  `github-failed` even though the publish landed. The draft self-heals on
  the next save's `ensureDraftAndRebase`, but the user sees an error for a
  publish that succeeded. Smooth this (e.g. report success-with-warning
  when the `main` commit landed). From ADR-012 PR-1 deep review.

