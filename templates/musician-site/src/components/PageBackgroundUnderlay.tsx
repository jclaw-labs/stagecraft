import type { CSSProperties } from "react";

import { isVectorExt, type ImageMetadata } from "@/lib/image-types";
import { largestVariantUrl, originalImageUrl } from "@/lib/image-urls";

/**
 * Fixed-positioned background layer painted behind page content.
 * Shared between two consumers:
 *
 *   1. `(public)/layout.tsx` renders the site-wide
 *      `siteConfig.pageBackground` once for every public page.
 *   2. `(public)/[[...slug]]/page.tsx` renders a per-page underlay
 *      when the page's root props set `pageBackground` — paints on
 *      top of the layout's layer so per-page overrides the site-wide
 *      default. The legacy template had the same two-layer model.
 *
 * Underlay rather than `background-attachment: fixed` on the wrapper
 * because iOS Safari treats that as `scroll`; a fixed-positioned
 * element behaves consistently across devices and was the legacy
 * pattern.
 *
 * Format negotiation
 * ------------------
 * Renders a `<picture>` with avif preferred + webp fallback (the
 * sharp pipeline emits both at every variant width). Saves ~10-20%
 * on the background-image transfer for browsers that support avif
 * (Chrome 85+, Firefox 113+, Safari 16+). Older browsers fall through
 * to the webp `<img>`. SVG / ICO uploads bypass the variant
 * pipeline so render a bare `<img>` pointing at the original.
 *
 * Overlay tint
 * ------------
 * `overlayOpacity` (0..1) paints a black tint over the image for
 * text-legibility on busy / bright backgrounds. 0 (default) means
 * no overlay — the image shows through unchanged. Common values
 * are 0.2-0.5 for typical use cases. Rendered as a sibling
 * fixed-positioned `<div>` that sits at the same z-index as the
 * image but later in DOM order, so it paints on top.
 *
 * Accessibility
 * -------------
 * `aria-hidden` because the image is decorative; `alt=""` so screen
 * readers skip it entirely. `pointerEvents: "none"` so the underlay
 * can't intercept clicks even if a future style positions it above
 * the flow. `backgroundColor` on the `<img>` matches the appearance's
 * `--color-background` token so a slow / failed image load doesn't
 * flash white.
 */
export function PageBackgroundUnderlay({
  image,
  overlayOpacity = 0,
}: {
  image: ImageMetadata;
  /** 0..1 tint opacity painted over the image. 0 means no overlay. */
  overlayOpacity?: number;
}) {
  return (
    <>
      <PageBackgroundImage image={image} />
      {overlayOpacity > 0 ? <PageBackgroundOverlay opacity={overlayOpacity} /> : null}
    </>
  );
}

function PageBackgroundImage({ image }: { image: ImageMetadata }) {
  if (isVectorExt(image.originalExt)) {
    // Vector / icon: no sharp variants on disk. Serve the original
    // directly. SVG / ICO render as background fine via the bare
    // `<img>` flow; format negotiation doesn't apply.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={originalImageUrl(image)}
        alt=""
        aria-hidden="true"
        style={imgStyle}
      />
    );
  }
  const webpUrl = largestVariantUrl(image, "webp");
  const avifUrl = largestVariantUrl(image, "avif");
  // When no sharp variant fits the source width (e.g. a 256×256
  // favicon-style upload), both URLs degrade to the same original
  // (a JPG / PNG / WEBP / AVIF — whichever the artist uploaded).
  // Emitting a `<source type="image/avif">` that points at a JPG
  // is harmless (browsers spot the type mismatch and skip the
  // source), but the HTML reads as a bug on inspection. Skip the
  // `<picture>` wrapper in that case and render a bare `<img>`.
  if (webpUrl === avifUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={webpUrl} alt="" aria-hidden="true" style={imgStyle} />
    );
  }
  return (
    // `<picture>` itself is layout-transparent and AT-invisible —
    // only the inner `<img>` shows. Browsers walk `<source>` in
    // document order and pick the first whose `type` matches a
    // supported format; the `<img>` is the universal fallback.
    <picture>
      <source srcSet={avifUrl} type="image/avif" />
      <img src={webpUrl} alt="" aria-hidden="true" style={imgStyle} />
    </picture>
  );
}

/**
 * Black tint painted over the page-background image for text-
 * legibility. Same fixed-positioning + z-index as the image so it
 * sits in the same plane; later in DOM order so it paints on top
 * (without needing a different z-index). `pointer-events: none` so
 * clicks pass through to the page content.
 */
function PageBackgroundOverlay({ opacity }: { opacity: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        pointerEvents: "none",
        backgroundColor: "black",
        opacity,
      }}
    />
  );
}

/**
 * Inline style for the fixed-positioned underlay `<img>`. Both the
 * vector branch and the raster `<picture>` branch use the same
 * geometry — `<picture>` doesn't render anything itself; the inner
 * `<img>` is what carries position + sizing.
 *
 * `object-fit: cover` + `object-position: center` reproduce the
 * old `background-size: cover; background-position: center`
 * behaviour. Browser-agnostic; works on all evergreen browsers.
 */
const imgStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100%",
  height: "100%",
  zIndex: -1,
  pointerEvents: "none",
  objectFit: "cover",
  objectPosition: "center",
  backgroundColor: "var(--color-background)",
};

// `largestVariantUrl` / `originalImageUrl` live in lib/image-urls.ts —
// PhotoTile uses them too (lightbox image source).
