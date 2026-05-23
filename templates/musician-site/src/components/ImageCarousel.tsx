"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Image } from "@/components/Image";

import {
  CAROUSEL_ASPECT_RATIOS,
  type CarouselAspectRatio,
  type ImageCarouselSlide,
} from "./image-carousel-types";

/**
 * ImageCarousel — scroll-snap carousel with React-driven controls.
 * Ported from the legacy template's `ImageCarousel.tsx`, refitted
 * to the new template's `<Image>` (responsive `<picture>` + LQIP)
 * and design-token inline styles.
 *
 * Track architecture
 * ------------------
 * The slide track is a horizontally-scrolling `<ul>` with
 * `scroll-snap-type: x mandatory`, so native trackpad / touch /
 * wheel scrolling lands on slide boundaries automatically.
 * Pre-hydration the SSR'd track is already functional — visitors
 * can drag through slides before JS arrives. React's job after
 * hydration is just:
 *
 *   1. Wire prev/next buttons to programmatic `scrollTo` on the
 *      track.
 *   2. Track which slide is active via IntersectionObserver so
 *      dots, arrow disabled state, and the aria-live region
 *      update regardless of input modality (touch / trackpad /
 *      keyboard / button click).
 *
 * No wrap-around. With native scroll the user can't infinitely
 * scroll past either end, and JS-only wrap (resetting scrollLeft
 * mid-animation) fights the snap engine. Edges disable the
 * corresponding arrow.
 *
 * IntersectionObserver over `scroll` listener: only fires on
 * intersection-state change (cheap), and with a high threshold
 * (0.6) naturally debounces — no rAF throttling needed.
 *
 * Navigation invariant
 * --------------------
 * At least one of (arrows, dots) must stay visible — a carousel
 * with both hidden is a dead-end on touch / screen-reader devices.
 * When the artist toggles both off, we force-render dots so the
 * artist can't lock visitors out. Same compromise the legacy made.
 */

export interface ImageCarouselProps {
  slides: ReadonlyArray<ImageCarouselSlide>;
  areArrowsHidden?: boolean;
  areDotsHidden?: boolean;
  aspectRatio?: CarouselAspectRatio;
}

export function ImageCarousel({
  slides,
  areArrowsHidden = false,
  areDotsHidden = false,
  aspectRatio = "16/9",
}: ImageCarouselProps) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const slideCount = slides.length;
  const hasMultipleSlides = slideCount > 1;
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === slideCount - 1;
  const activeSlide = slides[activeIndex];

  // Force at least one nav mechanism. If the artist hid both, show
  // dots — they're the more screen-reader-friendly of the two.
  const showArrows = !areArrowsHidden && hasMultipleSlides;
  const showDots = (!areDotsHidden || areArrowsHidden) && hasMultipleSlides;

  const scrollToSlide = useCallback((target: number) => {
    const track = trackRef.current;
    if (!track) return;
    const slide = track.children[target] as HTMLElement | undefined;
    if (!slide) return;
    // Honour `prefers-reduced-motion: reduce` — the OS-level
    // "minimise animations" toggle. Smooth-scrolling carousels
    // jolt motion-sensitive users; jump-cut is the right
    // behaviour for them.
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({
      left: slide.offsetLeft - track.offsetLeft,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  const goNext = useCallback(() => {
    if (!isLast) scrollToSlide(activeIndex + 1);
  }, [activeIndex, isLast, scrollToSlide]);

  const goPrev = useCallback(() => {
    if (!isFirst) scrollToSlide(activeIndex - 1);
  }, [activeIndex, isFirst, scrollToSlide]);

  // Track the active slide as the user scrolls. Observer fires
  // when a slide crosses the 60% intersection threshold inside the
  // track viewport — high enough that a slide only becomes "active"
  // once it dominates the viewport, low enough that flick-scrolls
  // land on the right index quickly.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !hasMultipleSlides) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // During scroll multiple slides may briefly satisfy the
        // threshold (snap-in-between). Pick the entry with the
        // highest ratio so the active index stays deterministic.
        let best: IntersectionObserverEntry | undefined;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!best || entry.intersectionRatio > best.intersectionRatio) {
            best = entry;
          }
        }
        if (!best) return;
        const idx = Number((best.target as HTMLElement).dataset.slideIndex);
        if (Number.isFinite(idx)) setActiveIndex(idx);
      },
      { root: track, threshold: 0.6 },
    );

    for (const child of Array.from(track.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [hasMultipleSlides, slideCount]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      if (!hasMultipleSlides) return;
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
          event.preventDefault();
          goPrev();
          break;
        case "Home":
          event.preventDefault();
          scrollToSlide(0);
          break;
        case "End":
          event.preventDefault();
          scrollToSlide(slideCount - 1);
          break;
        default:
          break;
      }
    },
    [goNext, goPrev, hasMultipleSlides, scrollToSlide, slideCount],
  );

  if (slideCount === 0) {
    // Editor placeholder — no slides configured yet. The artist
    // adds slides via the Puck inspector; rendering a non-
    // functional empty track on the public site is worse than
    // rendering nothing.
    return null;
  }

  const trackStyle: CSSProperties = {
    ...trackBaseStyle,
    aspectRatio,
  };

  return (
    <div
      className="stagecraft-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Image carousel"
    >
      <ul
        ref={trackRef}
        className="stagecraft-carousel-track"
        style={trackStyle}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {slides.map((slide, index) => {
          // Per-slide caption is the override; image-level caption
          // is the default. Lets an artist set one caption on the
          // image (in the picker) and reuse it across surfaces
          // without retyping per-slide.
          const caption = slide.caption ?? slide.image.caption;
          return (
            <li
              key={`${slide.image.id}-${index}`}
              className="stagecraft-carousel-slide"
              data-slide-index={index}
              role="group"
              aria-roledescription="slide"
              aria-label={`Slide ${index + 1} of ${slideCount}`}
            >
              {/* Image + caption wrapped in `<figure>` so `<figcaption>`
                  lives in its specified parent — outside `<figure>`,
                  `<figcaption>` is undefined semantically and screen-
                  reader handling is inconsistent. */}
              <figure style={figureStyle}>
                <SlideImage slide={slide} isFirst={index === 0} />
                {caption ? (
                  <figcaption style={captionStyle}>{caption}</figcaption>
                ) : null}
              </figure>
            </li>
          );
        })}
      </ul>

      {showArrows ? (
        <>
          <button
            type="button"
            onClick={goPrev}
            disabled={isFirst}
            aria-label="Previous slide"
            style={arrowStyle(isFirst, "prev")}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={isLast}
            aria-label="Next slide"
            style={arrowStyle(isLast, "next")}
          >
            <span aria-hidden="true">›</span>
          </button>
        </>
      ) : null}

      {showDots ? (
        // Plain list with an accessible name. The legacy template
        // used `role="tablist"` + `role="tab"` here, but the
        // carousel's slides are `role="group"
        // aria-roledescription="slide"` (the WAI-ARIA APG carousel
        // pattern), not `role="tabpanel"`. A tab without a matching
        // tabpanel is incomplete ARIA — assistive tech can't follow
        // the relationship. The implicit `role="list"` on `<ul>`
        // plus `aria-label` is the more idiomatic semantic here —
        // AT announces "list, Slide indicators, N items"; the
        // active button is flagged via `aria-current="true"`
        // (the right idiom for pagination / picker buttons).
        <ul
          aria-label="Slide indicators"
          style={dotListStyle}
        >
          {slides.map((_, index) => {
            const isActive = index === activeIndex;
            return (
              <li key={index} style={dotItemStyle}>
                <button
                  type="button"
                  onClick={() => scrollToSlide(index)}
                  aria-label={`Go to slide ${index + 1}`}
                  aria-current={isActive ? "true" : undefined}
                  style={dotStyle(isActive)}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Live region announces the active slide's alt text.
          `polite` so it doesn't preempt other speech. */}
      <div style={srOnlyStyle} aria-live="polite" aria-atomic="true">
        {activeSlide ? activeSlide.image.alt : ""}
      </div>
    </div>
  );
}

/**
 * Per-slide image. First slide loads eagerly (above-the-fold on
 * render); the rest lazy-load. The track's `overflow-x: auto`
 * means lazy slides only paint when the user scrolls — bandwidth
 * win on long carousels.
 *
 * `sizes="100vw"` because each slide fills 100% of the track width
 * at all viewports (the track itself is full-width by default).
 * A narrower sizes hint would cause the browser to pick a smaller
 * srcSet variant and blur the image on wide screens.
 */
function SlideImage({
  slide,
  isFirst,
}: {
  slide: ImageCarouselSlide;
  isFirst: boolean;
}): ReactNode {
  return <Image image={slide.image} sizes="100vw" isPriority={isFirst} />;
}

// ---------------------------------------------------------------------------
// Styles — token-driven inline + class hooks. The class hooks
// (.stagecraft-carousel-track, .stagecraft-carousel-slide) carry
// scroll-snap rules in globals.css; inline styles handle the per-
// instance computed values (aspectRatio) and stateful styling
// (arrow disabled, dot active).
// ---------------------------------------------------------------------------

const trackBaseStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
};

// Per-slide figure stretches to fill the snap-shaped slide cell so
// the image + caption layer correctly. No margin (browser default
// is 1em horizontal).
const figureStyle: CSSProperties = {
  position: "relative",
  margin: 0,
  width: "100%",
  height: "100%",
};

const captionStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-action-fg)",
  background: "var(--color-overlay)",
};

function arrowStyle(isDisabled: boolean, side: "prev" | "next"): CSSProperties {
  // `disabled` on the button already prevents clicks; no need for
  // a redundant `pointer-events: none`.
  return {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    [side === "prev" ? "left" : "right"]: "var(--space-2)",
    width: "2.5rem",
    height: "2.5rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    fontSize: "var(--font-size-lg)",
    fontWeight: "var(--font-weight-semibold)" as unknown as number,
    cursor: isDisabled ? "default" : "pointer",
    opacity: isDisabled ? 0.4 : 1,
  };
}

const dotListStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: "var(--space-2)",
  margin: "var(--space-3) 0 0",
  padding: 0,
  listStyle: "none",
};

const dotItemStyle: CSSProperties = {
  margin: 0,
};

function dotStyle(isActive: boolean): CSSProperties {
  return {
    width: "0.625rem",
    height: "0.625rem",
    padding: 0,
    border: 0,
    borderRadius: "50%",
    background: isActive ? "var(--color-text)" : "var(--color-border-strong)",
    cursor: "pointer",
  };
}

const srOnlyStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  border: 0,
};

// Re-export constants for source-compat with consumers.
export { CAROUSEL_ASPECT_RATIOS };
export type { CarouselAspectRatio, ImageCarouselSlide };
