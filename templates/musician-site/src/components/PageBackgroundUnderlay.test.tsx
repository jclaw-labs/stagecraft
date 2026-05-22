/**
 * Unit tests for the shared `PageBackgroundUnderlay` component. The
 * layout's full-stack test (`app/(public)/layout.test.tsx`) covers
 * the integration path — site config → render → assert HTML — so
 * this file locks the per-image variant-URL logic without re-paying
 * the content-store setup cost.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PageBackgroundUnderlay } from "./PageBackgroundUnderlay";
import { asImageId, type ImageMetadata } from "@/lib/image-types";

function image(overrides: Partial<ImageMetadata> = {}): ImageMetadata {
  return {
    id: asImageId("abc1234567890def"),
    alt: "background",
    width: 2400,
    height: 1600,
    placeholderDataUri: "data:image/webp;base64,AAAA",
    contentSlug: "home",
    originalExt: "jpg",
    ...overrides,
  };
}

describe("<PageBackgroundUnderlay> — raster (picture + format negotiation)", () => {
  it("renders a <picture> with an avif <source> + webp <img> fallback", () => {
    // Browsers that support avif pick the `<source>`; others fall
    // through to the `<img src>`. Both reference the same width
    // variant (largest that fits); only the format differs.
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toMatch(/<picture>/);
    expect(html).toMatch(/<source[^>]+type="image\/avif"[^>]+srcSet="\/images\/home\/abc1234567890def\/1600\.avif"|<source[^>]+srcSet="\/images\/home\/abc1234567890def\/1600\.avif"[^>]+type="image\/avif"/);
    expect(html).toContain('<img src="/images/home/abc1234567890def/1600.webp"');
  });

  it("picks the largest available variant width for both formats", () => {
    // Source width 2400 → all three variant widths (400/800/1600)
    // qualify; largest wins for both avif + webp.
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toContain("/images/home/abc1234567890def/1600.avif");
    expect(html).toContain("/images/home/abc1234567890def/1600.webp");
  });

  it("renders a bare <img> (no <picture>) when no variant fits the source width", () => {
    // 256×256 favicon-style upload — smaller than the smallest
    // variant (400), so no sized files exist on disk. Both avif
    // and webp degrade to the same URL (the original). Skip the
    // `<picture>` wrapper entirely: emitting a
    // `<source type="image/avif">` pointing at a JPG is harmless
    // (browser detects type mismatch) but misleading on
    // inspection.
    const html = renderToStaticMarkup(
      <PageBackgroundUnderlay image={image({ width: 256, height: 256 })} />,
    );
    expect(html).toContain("/images/home/abc1234567890def/original.jpg");
    expect(html).not.toMatch(/<picture/);
    expect(html).not.toMatch(/<source/);
  });

  it("positions the <img> as a fixed underlay (the picture element is layout-transparent)", () => {
    // `<picture>` doesn't render anything itself; the inner `<img>`
    // carries the position + sizing. Lock the fixed-positioning so
    // a future refactor doesn't lose the underlay semantic.
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("position:fixed");
    expect(html).toContain("inset:0");
    expect(html).toContain("z-index:-1");
    expect(html).toContain("pointer-events:none");
  });

  it("uses object-fit: cover so the image fills the viewport", () => {
    // Equivalent to the old `background-size: cover`. Centered crop
    // for landscape / portrait sources alike.
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("object-position:center");
  });

  it("includes a token-driven background-color fallback for slow / failed loads", () => {
    // Without a backgroundColor, a slow image load flashes white.
    // The token matches the appearance system's `--color-background`.
    // Lives on the `<img>` because that's the rendered element
    // (`<picture>` is layout-transparent).
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toContain("background-color:var(--color-background)");
  });

  it("marks the image as decorative (empty alt, aria-hidden)", () => {
    // Background images are presentational; AT should skip them.
    // Both `alt=""` and `aria-hidden` are belt-and-suspenders —
    // either alone is sufficient, but combining matches the
    // WAI-ARIA decorative-image pattern.
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toMatch(/alt=""/);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("<PageBackgroundUnderlay> — vector (SVG / ICO)", () => {
  it("renders a bare <img> (no <picture>) for SVG", () => {
    // SVG bypasses the sharp variant pipeline (no .avif / .webp
    // sized variants on disk). Emitting a `<source srcSet=...avif>`
    // pointing at the SVG would mis-declare the type. Skip
    // `<picture>` entirely.
    const html = renderToStaticMarkup(
      <PageBackgroundUnderlay image={image({ originalExt: "svg" })} />,
    );
    expect(html).not.toMatch(/<picture/);
    expect(html).not.toMatch(/<source/);
    expect(html).toContain("/images/home/abc1234567890def/original.svg");
  });

  it("renders a bare <img> for ICO", () => {
    const html = renderToStaticMarkup(
      <PageBackgroundUnderlay image={image({ originalExt: "ico" })} />,
    );
    expect(html).not.toMatch(/<picture/);
    expect(html).toContain("/images/home/abc1234567890def/original.ico");
  });

  it("vector branch keeps the same fixed-positioning + accessibility", () => {
    const html = renderToStaticMarkup(
      <PageBackgroundUnderlay image={image({ originalExt: "svg" })} />,
    );
    expect(html).toContain("position:fixed");
    expect(html).toContain("object-fit:cover");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/alt=""/);
  });
});
