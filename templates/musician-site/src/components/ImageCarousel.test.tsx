/**
 * SSR snapshot coverage for `ImageCarousel`. Interactive behaviour
 * (scroll-snap-driven IntersectionObserver, arrow click handlers,
 * keyboard navigation, dot tab) needs a real browser and isn't
 * exercised here — those land if/when we wire jsdom + a real
 * scroll-event simulator. The structural invariants (slide count,
 * arrow / dot visibility rules, the "force dots when arrows hidden
 * and vice versa" floor, aspect-ratio inline style, ARIA roles)
 * are what locking in protects against silent regressions.
 *
 * The same renderToStaticMarkup pattern other public components
 * (Image, AppearanceStyles, NewsletterSignup) use.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ImageCarousel } from "./ImageCarousel";
import {
  CAROUSEL_ASPECT_RATIOS,
  type ImageCarouselSlide,
} from "./image-carousel-types";
import { asImageId, type ImageMetadata } from "@/lib/image-types";

const IMAGE_FIXTURE: ImageMetadata = {
  id: asImageId("abc1234567890def"),
  alt: "A photo",
  width: 1600,
  height: 1067,
  placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
  contentSlug: "home",
  originalExt: "jpg",
};

function slide(overrides: Partial<ImageCarouselSlide> = {}): ImageCarouselSlide {
  return { image: IMAGE_FIXTURE, ...overrides };
}

function render(opts: Parameters<typeof ImageCarousel>[0]): string {
  return renderToStaticMarkup(<ImageCarousel {...opts} />);
}

describe("ImageCarousel — empty / single slide", () => {
  it("renders nothing when slides is empty (no broken track)", () => {
    expect(render({ slides: [] })).toBe("");
  });

  it("renders the slide but suppresses navigation chrome for a single slide", () => {
    const html = render({ slides: [slide()] });
    // Slide image rendered.
    expect(html).toMatch(/<picture>/);
    expect(html).toContain('alt="A photo"');
    // Single-slide carousel: navigation chrome is pointless and
    // would mislead screen-reader users into thinking there's more
    // content. Arrows + dots both suppressed regardless of the
    // visibility props.
    expect(html).not.toMatch(/<button[^>]+aria-label="Previous slide"/);
    expect(html).not.toMatch(/<button[^>]+aria-label="Next slide"/);
    expect(html).not.toMatch(/role="tablist"/);
  });
});

describe("ImageCarousel — multi-slide chrome", () => {
  const slides = [slide({ image: { ...IMAGE_FIXTURE, alt: "One" } }), slide({ image: { ...IMAGE_FIXTURE, alt: "Two" } }), slide({ image: { ...IMAGE_FIXTURE, alt: "Three" } })];

  it("renders one slide per item with sequential ARIA labels", () => {
    const html = render({ slides });
    // The role + label pair is what assistive tech reads —
    // "Slide 1 of 3", "Slide 2 of 3", etc.
    expect(html).toContain('aria-label="Slide 1 of 3"');
    expect(html).toContain('aria-label="Slide 2 of 3"');
    expect(html).toContain('aria-label="Slide 3 of 3"');
  });

  it("emits prev/next arrows + dot tabs by default", () => {
    const html = render({ slides });
    expect(html).toMatch(/<button[^>]+aria-label="Previous slide"/);
    expect(html).toMatch(/<button[^>]+aria-label="Next slide"/);
    expect(html).toMatch(/<ul[^>]+role="tablist"/);
    // One dot per slide.
    const dotMatches = html.match(/aria-label="Go to slide \d+"/g) ?? [];
    expect(dotMatches).toHaveLength(3);
  });

  it("hides arrows when areArrowsHidden is set; dots stay", () => {
    const html = render({ slides, areArrowsHidden: true });
    expect(html).not.toMatch(/<button[^>]+aria-label="Previous slide"/);
    expect(html).toMatch(/<ul[^>]+role="tablist"/);
  });

  it("hides dots when areDotsHidden is set; arrows stay", () => {
    const html = render({ slides, areDotsHidden: true });
    expect(html).toMatch(/<button[^>]+aria-label="Previous slide"/);
    expect(html).not.toMatch(/<ul[^>]+role="tablist"/);
  });

  it("forces dots back on if the artist hid BOTH — never lock visitors out", () => {
    // A carousel with neither nav mechanism is a dead-end on touch
    // / screen-reader devices. The component overrides
    // areDotsHidden=true when areArrowsHidden=true so at least one
    // mechanism survives.
    const html = render({
      slides,
      areArrowsHidden: true,
      areDotsHidden: true,
    });
    expect(html).not.toMatch(/<button[^>]+aria-label="Previous slide"/);
    expect(html).toMatch(/<ul[^>]+role="tablist"/);
  });

  it("initial Prev button is disabled (first slide is active SSR)", () => {
    const html = render({ slides });
    // The disabled state on first paint reflects the start-of-track
    // anchor; the IntersectionObserver updates it on scroll
    // post-hydration. Lock the SSR baseline. React's attribute
    // ordering puts `disabled=""` before our aria-label, so match
    // both directions.
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*aria-label="Previous slide"|<button[^>]*aria-label="Previous slide"[^>]*disabled/,
    );
    expect(html).not.toMatch(
      /<button[^>]*disabled[^>]*aria-label="Next slide"|<button[^>]*aria-label="Next slide"[^>]*disabled/,
    );
  });
});

describe("ImageCarousel — aspect ratio", () => {
  const slides = [slide(), slide()];

  it.each([...CAROUSEL_ASPECT_RATIOS])(
    "applies %s as a CSS aspect-ratio on the track",
    (ratio) => {
      const html = render({ slides, aspectRatio: ratio });
      // The inline style on the `<ul class="stagecraft-carousel-
      // track">` carries `aspect-ratio: <ratio>`. CSS aspect-ratio
      // serialises with a space around the slash.
      const escapedRatio = ratio.replace(/\//g, "\\s*/\\s*");
      expect(html).toMatch(new RegExp(`aspect-ratio:\\s*${escapedRatio}`));
    },
  );

  it("defaults to 16/9 when aspectRatio is omitted", () => {
    const html = render({ slides });
    expect(html).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
  });
});

describe("ImageCarousel — ARIA structure", () => {
  it("wraps the carousel in a `region` with `aria-roledescription=\"carousel\"`", () => {
    // Establishes the carousel-as-landmark semantic so screen
    // readers can list / skip it. Mandatory per the W3C ARIA
    // Authoring Practices Guide on carousels.
    const html = render({ slides: [slide()] });
    expect(html).toMatch(/role="region"/);
    expect(html).toMatch(/aria-roledescription="carousel"/);
  });

  it("exposes a `polite` live region announcing the active slide", () => {
    // Single-slide carousel renders the live region too (the
    // active-slide concept still applies; just nothing to
    // transition between). The component's SSR pass writes the
    // first slide's alt as the initial announcement.
    const html = render({ slides: [slide({ image: { ...IMAGE_FIXTURE, alt: "Stage" } })] });
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toMatch(/aria-atomic="true"/);
    expect(html).toContain("Stage");
  });

  it("renders the slide caption as a figcaption when present", () => {
    const html = render({
      slides: [slide({ caption: "Soundcheck" })],
    });
    expect(html).toContain("Soundcheck");
    expect(html).toMatch(/<figcaption/);
  });

  it("falls back to image.caption when the slide caption is unset", () => {
    // Two-layer caption model: per-slide is the override, the
    // image-level caption (set once in the picker) is the default.
    // Lets an artist reuse an image's caption across surfaces.
    const html = render({
      slides: [
        {
          image: { ...IMAGE_FIXTURE, caption: "From the image picker" },
        },
      ],
    });
    expect(html).toContain("From the image picker");
    expect(html).toMatch(/<figcaption/);
  });

  it("per-slide caption overrides image.caption (override beats default)", () => {
    const html = render({
      slides: [
        {
          image: { ...IMAGE_FIXTURE, caption: "Image default" },
          caption: "Slide override",
        },
      ],
    });
    expect(html).toContain("Slide override");
    expect(html).not.toContain("Image default");
  });

  it("wraps image + figcaption in a `<figure>` (figcaption outside figure is undefined HTML)", () => {
    // `<figcaption>` without a `<figure>` parent is semantically
    // meaningless — screen-reader handling diverges across engines.
    // Per the HTML spec, figcaption is specified as a child of figure.
    const html = render({
      slides: [slide({ caption: "Soundcheck" })],
    });
    expect(html).toMatch(/<figure[\s>][\s\S]*<figcaption/);
  });

  it("uses the --color-overlay token for the caption background (no raw rgba)", () => {
    // CLAUDE.md §7: no raw color values inline. The overlay token
    // lives in globals.css so caption styling stays consistent
    // with any future text-on-image surface (Quote-with-bg, etc.).
    const html = render({
      slides: [slide({ caption: "x" })],
    });
    expect(html).toContain("var(--color-overlay)");
    expect(html).not.toMatch(/rgba\(/);
  });
});

describe("ImageCarousel — first-slide priority loading", () => {
  it("loads the first slide eagerly via `loading=\"eager\"` + fetchpriority=\"high\"", () => {
    // Above-the-fold carousels paint immediately; lazy-loading the
    // first slide flashes the surface-raised background while the
    // image fetches. The legacy template made the same call.
    //
    // React's renderToStaticMarkup serialises the attr as
    // `fetchPriority` (camelCase) — browsers parse the attribute
    // case-insensitively so runtime behaviour is correct; match
    // either casing in the assertion.
    const html = render({
      slides: [slide(), slide(), slide()],
    });
    const firstImgMatch = html.match(/<img[^>]+alt="A photo"[^>]*>/);
    expect(firstImgMatch).toBeTruthy();
    const firstImg = firstImgMatch?.[0] ?? "";
    expect(firstImg).toContain('loading="eager"');
    expect(firstImg).toMatch(/fetchpriority="high"|fetchPriority="high"/);
  });

  it("lazy-loads all non-first slides (bandwidth win on long carousels)", () => {
    const html = render({
      slides: [
        slide({ image: { ...IMAGE_FIXTURE, alt: "First" } }),
        slide({ image: { ...IMAGE_FIXTURE, alt: "Second" } }),
        slide({ image: { ...IMAGE_FIXTURE, alt: "Third" } }),
      ],
    });
    const secondImg = html.match(/<img[^>]+alt="Second"[^>]*>/)?.[0] ?? "";
    const thirdImg = html.match(/<img[^>]+alt="Third"[^>]*>/)?.[0] ?? "";
    expect(secondImg).toContain('loading="lazy"');
    expect(thirdImg).toContain('loading="lazy"');
    expect(secondImg).not.toMatch(/fetchpriority="high"|fetchPriority="high"/i);
    expect(thirdImg).not.toMatch(/fetchpriority="high"|fetchPriority="high"/i);
  });
});
