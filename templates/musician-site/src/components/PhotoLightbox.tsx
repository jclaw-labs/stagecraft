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
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

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
    if (event.target === event.currentTarget) close();
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
          src={current.url}
          alt={current.alt}
          // `width` + `height` are the intrinsic source dimensions
          // (PhotoTile threads them via data attributes). The
          // browser uses them to reserve aspect-ratio-correct space
          // before the image paints, so the figure doesn't snap-
          // resize as each image loads. CSS `max-width: 100%` /
          // `max-height` keep the on-screen size capped to the
          // viewport. We skip the attributes entirely when either is
          // 0 (older content without the data attrs); the image
          // still loads, just without the layout-shift hint.
          {...(current.width > 0 && current.height > 0
            ? { width: current.width, height: current.height }
            : {})}
          style={imageStyle}
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
