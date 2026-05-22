import type { CSSProperties } from "react";

import {
  IMAGE_VARIANT_WIDTHS,
  isVectorExt,
  type ImageMetadata,
} from "@/lib/image-types";

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
 * `aria-hidden` because the image is decorative; `zIndex: -1` so the
 * page paints over it with normal flow. `backgroundColor` fallback
 * matches the appearance's `--color-background` token so a slow /
 * failed image load doesn't flash white. `pointerEvents: "none"` so
 * the underlay can't intercept clicks even if a future style
 * positions it above the flow.
 */
export function PageBackgroundUnderlay({ image }: { image: ImageMetadata }) {
  const style: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: -1,
    pointerEvents: "none",
    backgroundColor: "var(--color-background)",
    backgroundImage: `url("${largestVariantUrl(image, "webp")}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
  return <div aria-hidden="true" style={style} />;
}

/**
 * Largest sharp-generated variant that exists for the image (the
 * pipeline only emits widths ≤ source width), falling back to the
 * original upload when none exist (small uploads like 256x256
 * favicons, ICO/SVG uploads bypassing sharp).
 *
 * webp because the variant pipeline emits webp + avif and webp is
 * universally supported as of 2024. Future: emit a `<picture>`
 * underlay with both formats so newer Safari benefits from avif.
 */
function largestVariantUrl(image: ImageMetadata, format: "webp" | "avif"): string {
  if (isVectorExt(image.originalExt)) return originalUrl(image);
  const eligible = IMAGE_VARIANT_WIDTHS.filter((w) => w <= image.width);
  if (eligible.length === 0) return originalUrl(image);
  const largest = Math.max(...eligible);
  return `/images/${image.contentSlug}/${image.id}/${largest}.${format}`;
}

function originalUrl(image: ImageMetadata): string {
  return `/images/${image.contentSlug}/${image.id}/original.${image.originalExt}`;
}
