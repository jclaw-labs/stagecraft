"use client";

import {
  useCallback,
  useEffect,
  useId,
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
  // Stable per-instance id so the live region's aria-controls and
  // the dot tab indices don't collide across multiple carousels on
  // one page.
  const carouselId = useId();

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
    track.scrollTo({
      left: slide.offsetLeft - track.offsetLeft,
      behavior: "smooth",
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
        data-carousel-id={carouselId}
        style={trackStyle}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {slides.map((slide, index) => (
          <li
            key={`${slide.image.id}-${index}`}
            className="stagecraft-carousel-slide"
            data-slide-index={index}
            role="group"
            aria-roledescription="slide"
            aria-label={`Slide ${index + 1} of ${slideCount}`}
          >
            <SlideImage slide={slide} isFirst={index === 0} />
            {slide.caption ? (
              <figcaption style={captionStyle}>{slide.caption}</figcaption>
            ) : null}
          </li>
        ))}
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
        <ul
          role="tablist"
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
                  role="tab"
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
 * Per-slide image. First slide loads eagerly (it's above-the-fold
 * on render); the rest lazy-load. The track's `overflow: hidden`
 * means lazy slides never paint until the user scrolls — bandwidth
 * win on long carousels.
 */
function SlideImage({
  slide,
  isFirst,
}: {
  slide: ImageCarouselSlide;
  isFirst: boolean;
}): ReactNode {
  void isFirst; // <Image> doesn't currently surface `loading="eager"`
  // override; the public render path's default is lazy. Acceptable
  // for v1 — the active slide is the first non-zero scroll position
  // anyway. Wire through when <Image> gains the prop.
  return (
    <Image image={slide.image} sizes="(max-width: 800px) 100vw, 800px" />
  );
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

const captionStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-action-fg)",
  background: "rgba(0, 0, 0, 0.55)",
};

function arrowStyle(isDisabled: boolean, side: "prev" | "next"): CSSProperties {
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
    pointerEvents: isDisabled ? "none" : "auto",
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
