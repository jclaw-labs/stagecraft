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

describe("<PageBackgroundUnderlay>", () => {
  it("renders a fixed-position div behind page content", () => {
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("position:fixed");
    expect(html).toContain("inset:0");
    expect(html).toContain("z-index:-1");
    expect(html).toContain("pointer-events:none");
  });

  it("uses cover-fit, centered, no-repeat background", () => {
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toContain("background-size:cover");
    expect(html).toContain("background-position:center");
    expect(html).toContain("background-repeat:no-repeat");
  });

  it("picks the largest available variant for raster images", () => {
    // Source width 2400 → all three variants (400/800/1600) qualify;
    // largest wins.
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toContain("/images/home/abc1234567890def/1600.webp");
  });

  it("falls back to the original when no variant fits (small upload)", () => {
    // 256×256 favicon-style upload — smaller than the smallest
    // variant (400), so no sized files exist on disk.
    const html = renderToStaticMarkup(
      <PageBackgroundUnderlay image={image({ width: 256, height: 256 })} />,
    );
    expect(html).toContain("/images/home/abc1234567890def/original.jpg");
  });

  it("uses the original for vector uploads (no .webp variant exists)", () => {
    const html = renderToStaticMarkup(
      <PageBackgroundUnderlay image={image({ originalExt: "svg" })} />,
    );
    expect(html).toContain("/images/home/abc1234567890def/original.svg");
  });

  it("includes a token-driven color fallback for slow / failed loads", () => {
    // Without a backgroundColor, a slow image load flashes white.
    // The token matches the appearance system's --color-background.
    const html = renderToStaticMarkup(<PageBackgroundUnderlay image={image()} />);
    expect(html).toContain("background-color:var(--color-background)");
  });
});
