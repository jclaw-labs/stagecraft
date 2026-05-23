"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  clampPan,
  isZoomed,
  pinchScale,
  touchDistance,
  ZOOM_RESET,
  type ZoomState,
} from "@/lib/lightbox-zoom";

/**
 * Minimum horizontal pixel delta for a touch gesture to count as a
 * swipe (not a tap or jitter). Matches the value most mobile photo
 * viewers settle on — small enough to feel responsive, big enough
 * that a deliberate tap doesn't accidentally cycle the gallery.
 */
const SWIPE_THRESHOLD_PX = 50;

/**
 * Window after a successful swipe within which a backdrop click
 * gets suppressed. Mobile browsers synthesise a `click` from
 * touchstart+touchend on a normally-passive listener; without this
 * suppression, a backdrop swipe would cycle the photo AND fire the
 * backdrop-close handler. 500ms covers the worst-case touch→click
 * latency seen in the wild on slow Android devices.
 */
const SWIPE_CLICK_SUPPRESS_MS = 500;

/**
 * Single photo's worth of data the lightbox displays. The boot
 * component reads these off the `[data-photo-tile]` anchor's data-*
 * attributes — keeps the wire shape declarative and JSON-encoding-
 * free.
 */
export type LightboxImage = {
  /** Lightbox-size URL (the anchor's `href`; typically a sharp variant). */
  url: string;
  alt: string;
  caption: string;
  credit: string;
  /** Intrinsic source dimensions. The lightbox forwards these as
   *  `width` / `height` attributes on the `<img>` so the browser
   *  reserves aspect-ratio-correct space before the image paints —
   *  no layout shift inside the modal during load. */
  width: number;
  height: number;
};

export type PhotoLightboxProps = {
  images: LightboxImage[];
  /** Which image to start on. */
  initialIndex: number;
  /** Called when the user closes (Esc, click backdrop, click close button). */
  onClose: () => void;
};

/**
 * Modal lightbox for photo galleries. Mounted by
 * `PhotoLightboxBoot` when a `[data-photo-tile]` anchor is clicked
 * (the boot lives at the page root; click-delegated from
 * `[data-collection-view="photos"]`).
 *
 * Keyboard nav: Esc closes, ArrowLeft / ArrowRight cycle. Tab
 * cycles within the modal's focusable elements (close + prev / next
 * buttons) — manual focus trap because the document outside the
 * modal stays interactive otherwise.
 *
 * Focus restoration: the boot saves the triggering element before
 * opening; on close, it refocuses (handled there, not here, so this
 * component stays prop-driven).
 *
 * Click backdrop to close; click image surface doesn't propagate so
 * a stray click on the image isn't a close gesture.
 */
export function PhotoLightbox({ images, initialIndex, onClose }: PhotoLightboxProps) {
  const [index, setIndex] = useState(() => clamp(initialIndex, images.length));
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_RESET);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Touch swipe start point. Null when no active single-touch swipe
  // is in flight; reset on touchend / touchcancel / gesture switch.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // Active pinch (two-finger) gesture: the finger span + scale at the
  // moment the second finger landed. Null when not pinching.
  const pinchRef = useRef<{ startDistance: number; startScale: number } | null>(null);
  // Active pan (one-finger drag while zoomed): the start point + the
  // translation at drag start. Null when not panning.
  const panRef = useRef<{
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);
  // Synchronous mirror of `zoom`, read inside the native touch
  // listeners. It must be the source of truth (not a `[zoom]`-effect
  // copy): the listeners decide pan-vs-swipe at gesture START off
  // this value, and a one-finger touch landing immediately after a
  // pinch ends (a separate browser task) would read a stale scale if
  // the mirror only updated on a post-commit passive effect. `applyZoom`
  // writes the ref and schedules the render together.
  const zoomRef = useRef<ZoomState>(ZOOM_RESET);
  // Wall-clock millisecond at which the most recent touch GESTURE
  // ended (swipe, pinch, or pan). Mobile browsers synthesise a
  // `click` from a touch sequence, so without this a gesture that
  // ends on the backdrop would hit `handleBackdropClick` and close
  // the modal. We suppress any backdrop close in a wide window after.
  const lastSwipeAtRef = useRef<number>(0);

  const total = images.length;
  const current = images[index];

  const close = useCallback(() => onClose(), [onClose]);

  const next = useCallback(() => {
    if (total <= 1) return;
    setIndex((i) => (i + 1) % total);
  }, [total]);

  const prev = useCallback(() => {
    if (total <= 1) return;
    setIndex((i) => (i - 1 + total) % total);
  }, [total]);

  // Single mutation path for zoom: compute the next state from the
  // live ref, write the ref synchronously, then schedule the render.
  // Stable identity (no deps) so the listener effect doesn't churn.
  const applyZoom = useCallback((producer: (prev: ZoomState) => ZoomState) => {
    const nextZoom = producer(zoomRef.current);
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  }, []);

  // Move keyboard focus into the modal on first paint so Esc / arrow
  // keys land on the dialog's keydown handler rather than whatever
  // had focus before (typically the gallery anchor). The close
  // button is the natural landing — first focusable in tab order.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Lock background scrolling. Without this, ArrowLeft / ArrowRight
  // navigation also pages the underlying viewport on touch trackpads
  // and the bg scroll feels like a bug. Restored on unmount.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Reset zoom whenever the active image changes — a pan/zoom from the
  // previous photo shouldn't carry over to the next. `applyZoom` keeps
  // zoomRef in sync synchronously.
  useEffect(() => {
    applyZoom(() => ZOOM_RESET);
    pinchRef.current = null;
    panRef.current = null;
  }, [index, applyZoom]);

  // Touch-gesture pipeline. Attached as NATIVE non-passive listeners
  // (not React's synthetic onTouch*, which are passive since React 17)
  // so the pinch / pan handlers can `preventDefault()` to stop the
  // browser's own page-zoom + scroll while a gesture is in flight.
  //
  // Arbitration by touch count + zoom state:
  //   - 2 fingers              → pinch-zoom
  //   - 1 finger while zoomed  → pan
  //   - 1 finger while at 1x   → swipe-to-navigate (the un-zoomed case)
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    function measure(): { w: number; h: number } {
      const img = imgRef.current;
      // offsetWidth/Height are the layout size (unaffected by the CSS
      // transform), i.e. the rendered size at scale 1 — exactly what
      // clampPan needs to bound the translation.
      return { w: img?.offsetWidth ?? 0, h: img?.offsetHeight ?? 0 };
    }

    function onTouchStart(event: globalThis.TouchEvent) {
      if (event.touches.length === 2) {
        const a = event.touches[0]!;
        const b = event.touches[1]!;
        pinchRef.current = {
          startDistance: touchDistance(a, b),
          startScale: zoomRef.current.scale,
        };
        panRef.current = null;
        touchStartRef.current = null;
        return;
      }
      if (event.touches.length === 1) {
        const t = event.touches[0]!;
        pinchRef.current = null;
        if (isZoomed(zoomRef.current)) {
          panRef.current = {
            startX: t.clientX,
            startY: t.clientY,
            startTx: zoomRef.current.tx,
            startTy: zoomRef.current.ty,
          };
          touchStartRef.current = null;
        } else {
          touchStartRef.current = { x: t.clientX, y: t.clientY };
          panRef.current = null;
        }
        return;
      }
      // 3+ fingers — abandon any gesture.
      pinchRef.current = null;
      panRef.current = null;
      touchStartRef.current = null;
    }

    function onTouchMove(event: globalThis.TouchEvent) {
      if (pinchRef.current && event.touches.length === 2) {
        event.preventDefault();
        const a = event.touches[0]!;
        const b = event.touches[1]!;
        const scale = pinchScale(
          pinchRef.current.startScale,
          pinchRef.current.startDistance,
          touchDistance(a, b),
        );
        const { w, h } = measure();
        applyZoom((z) => clampPan({ scale, tx: z.tx, ty: z.ty }, w, h));
        return;
      }
      if (panRef.current && event.touches.length === 1) {
        event.preventDefault();
        const t = event.touches[0]!;
        const tx = panRef.current.startTx + (t.clientX - panRef.current.startX);
        const ty = panRef.current.startTy + (t.clientY - panRef.current.startY);
        const { w, h } = measure();
        applyZoom((z) => clampPan({ scale: z.scale, tx, ty }, w, h));
      }
      // Un-zoomed single-finger move = a swipe in progress. We don't
      // preventDefault (the body scroll-lock + touch-action already
      // stop the browser doing anything) so the synthesised click
      // still fires and the lastSwipeAtRef suppression can catch it.
    }

    function onTouchEnd(event: globalThis.TouchEvent) {
      const wasGesturing =
        pinchRef.current !== null ||
        panRef.current !== null ||
        touchStartRef.current !== null;

      // Swipe-to-navigate: only when a swipe was armed (un-zoomed,
      // single finger) and the gesture cleared the threshold.
      const start = touchStartRef.current;
      if (start && !isZoomed(zoomRef.current)) {
        const t = event.changedTouches[0];
        if (t) {
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) next();
            else prev();
          }
        }
      }

      // Pinch → pan handoff: one of two fingers lifted while zoomed.
      // Seed a pan from the surviving finger so "pinch to zoom, then
      // keep dragging with one finger" works without re-touching.
      if (pinchRef.current && event.touches.length === 1) {
        pinchRef.current = null;
        if (isZoomed(zoomRef.current)) {
          const t = event.touches[0]!;
          panRef.current = {
            startX: t.clientX,
            startY: t.clientY,
            startTx: zoomRef.current.tx,
            startTy: zoomRef.current.ty,
          };
        }
      } else if (pinchRef.current) {
        // Pinch fully ended. If it settled back to ~1x, snap to reset
        // so isZoomed() flips false and any residual translation clears.
        applyZoom((z) => (isZoomed(z) ? z : ZOOM_RESET));
      }

      // Stamp any gesture end (swipe / pinch / pan) so the synthesised
      // click the browser fires next on the backdrop is suppressed by
      // handleBackdropClick — otherwise a gesture ending on the empty
      // area beside the image could close the modal.
      if (wasGesturing) {
        lastSwipeAtRef.current = Date.now();
      }

      // Clear gesture state once every finger has lifted.
      if (event.touches.length === 0) {
        pinchRef.current = null;
        panRef.current = null;
        touchStartRef.current = null;
      }
    }

    function onTouchCancel() {
      pinchRef.current = null;
      panRef.current = null;
      touchStartRef.current = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [next, prev, applyZoom]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowRight":
        event.preventDefault();
        next();
        break;
      case "ArrowLeft":
        event.preventDefault();
        prev();
        break;
      case "Home":
        // Jump to the first image. Matches the ImageCarousel keyboard
        // contract and the standard "list with cursor" idiom (Tab-
        // strip / file picker / data grid all use Home/End).
        if (total > 1) {
          event.preventDefault();
          setIndex(0);
        }
        break;
      case "End":
        if (total > 1) {
          event.preventDefault();
          setIndex(total - 1);
        }
        break;
      case "Tab":
        // Manual focus trap. With only a handful of focusable
        // elements (close, prev, next), wrapping inside the dialog
        // keeps focus visible — the alternative is `inert` on the
        // document body, which is the cleaner long-term answer but
        // depends on a known wrapper element to mark inert.
        handleTabCycle(event);
        break;
      default:
        break;
    }
  }

  function handleTabCycle(event: KeyboardEvent<HTMLDivElement>) {
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    // Only close when the click landed on the backdrop itself, not
    // on a descendant (image, button, caption).
    if (event.target !== event.currentTarget) return;
    // Suppress the synthesised click that follows a backdrop swipe:
    // a horizontal swipe across the empty space beside the image
    // would otherwise cycle AND close (browsers fire `click` after
    // `touchend` when the move stays under their internal
    // movement-cancels-click threshold, which is much larger than
    // our 50px swipe threshold). Window is generous — touch→click
    // synthesis can lag a few hundred ms on slow Android devices.
    if (Date.now() - lastSwipeAtRef.current < SWIPE_CLICK_SUPPRESS_MS) return;
    close();
  }

  if (!current) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || "Photo viewer"}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      style={overlayStyle}
      data-testid="photo-lightbox"
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={close}
        aria-label="Close photo viewer"
        style={closeButtonStyle}
      >
        <span aria-hidden="true">×</span>
      </button>

      {total > 1 ? (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous photo"
            style={navButtonStyle("prev")}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next photo"
            style={navButtonStyle("next")}
          >
            <span aria-hidden="true">›</span>
          </button>
        </>
      ) : null}

      <figure style={figureStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={current.url}
          alt={current.alt}
          // `width` + `height` are the intrinsic source dimensions
          // (PhotoTile threads them via data attributes). The
          // browser uses them to reserve aspect-ratio-correct space
          // before the image paints, so the figure doesn't snap-
          // resize as each image loads. CSS `max-width: 100%` /
          // `max-height` keep the on-screen size capped to the
          // viewport.
          //
          // Both-or-nothing on the spread: aspect-ratio reservation
          // needs BOTH axes — emitting just `width="1600"` with
          // `height` missing would lock width but let height
          // collapse to 0, which is worse than no hint at all.
          // Older content without the data attrs (or `0` parsed
          // from missing attrs) falls back to dimensionless render
          // — the image still loads, just without the CLS hint.
          {...(current.width > 0 && current.height > 0
            ? { width: current.width, height: current.height }
            : {})}
          style={{
            ...imageStyle,
            transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
            transformOrigin: "center center",
            // `grab` cursor hints the image is pannable once zoomed.
            cursor: isZoomed(zoom) ? "grab" : undefined,
            // Promote to a compositor layer only while zoomed so the
            // per-touchmove transform updates stay on the GPU; release
            // the layer at rest to avoid a permanent memory cost.
            willChange: isZoomed(zoom) ? "transform" : undefined,
          }}
          // The lightbox image is above the fold (it's the whole
          // viewport on open); eager load + high fetchpriority avoid
          // the blank-canvas-then-paint flash.
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        {current.caption || current.credit ? (
          <figcaption style={captionStyle}>
            {current.caption ? <span>{current.caption}</span> : null}
            {current.credit ? (
              <span style={creditStyle}>
                {current.caption ? " — " : ""}
                {current.credit}
              </span>
            ) : null}
          </figcaption>
        ) : null}
      </figure>

      {total > 1 ? (
        <div style={counterStyle} aria-live="polite" aria-atomic="true">
          {index + 1} / {total}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Clamp the requested initial index into the [0, length-1] range.
 * Defensive against a stale event payload referencing a removed
 * tile.
 */
function clamp(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  if (index < 0) return 0;
  if (index >= length) return Math.max(0, length - 1);
  return index;
}

// ---------------------------------------------------------------------------
// Styles — token-only per CLAUDE.md §7. Inline because the lightbox
// is a singleton client component; a CSS module would be overkill.
// ---------------------------------------------------------------------------

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "var(--color-overlay)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-4)",
  // We own all touch gestures (swipe / pinch / pan) via native
  // listeners, so tell the browser not to run its own pan/zoom here.
  // Taps + clicks are unaffected (touch-action only gates continuous
  // gestures), so the close / nav buttons + backdrop click still work.
  touchAction: "none",
};

const figureStyle: CSSProperties = {
  margin: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-3)",
  maxWidth: "100%",
  maxHeight: "100%",
};

const imageStyle: CSSProperties = {
  maxWidth: "100%",
  maxHeight: "calc(100vh - var(--space-32))",
  objectFit: "contain",
  display: "block",
};

const captionStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-action-fg)",
  textAlign: "center",
  maxWidth: "var(--max-width-content)",
};

const creditStyle: CSSProperties = {
  fontStyle: "italic",
  color: "var(--color-action-fg)",
};

const counterStyle: CSSProperties = {
  position: "absolute",
  bottom: "var(--space-4)",
  left: "50%",
  transform: "translateX(-50%)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-action-fg)",
};

const closeButtonStyle: CSSProperties = {
  position: "absolute",
  top: "var(--space-3)",
  right: "var(--space-3)",
  width: "2.5rem",
  height: "2.5rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-action-fg)",
  background: "transparent",
  color: "var(--color-action-fg)",
  fontSize: "var(--font-size-xl)",
  cursor: "pointer",
};

function navButtonStyle(side: "prev" | "next"): CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    [side === "prev" ? "left" : "right"]: "var(--space-3)",
    width: "3rem",
    height: "3rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    border: "1px solid var(--color-action-fg)",
    background: "transparent",
    color: "var(--color-action-fg)",
    fontSize: "var(--font-size-xl)",
    cursor: "pointer",
  };
}
