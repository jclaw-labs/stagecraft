import {
  IMAGE_VARIANT_WIDTHS,
  isVectorExt,
  type ImageMetadata,
  type ImageVariantFormat,
} from "./image-types";

/**
 * Path to the unmodified upload on disk. Vector formats (SVG, ICO)
 * bypass the sharp variant pipeline so this is also the only URL
 * available for them.
 */
export function originalImageUrl(image: ImageMetadata): string {
  return `/images/${image.contentSlug}/${image.id}/original.${image.originalExt}`;
}

/**
 * Largest sharp-generated variant URL for a raster image — falls
 * back to the original when no variant fits (small uploads like
 * 256×256 favicons) or the format is vector.
 *
 * `format` defaults to `webp` because that's universally supported
 * as of 2024 and the variant pipeline emits both webp and avif.
 * Callers can request `avif` explicitly — useful when building a
 * future `<picture>` underlay that prefers avif on supporting
 * browsers and falls back to webp.
 *
 * Used by the photo lightbox and the `PageBackgroundUnderlay` for
 * the "biggest variant that exists on disk" URL — both want the
 * largest cached / optimised file rather than the multi-megabyte
 * original.
 *
 * Vector / icon: returns the original. SVGs scale to any size; ICO
 * is for the favicon surface which doesn't benefit from sharp
 * variants. Both already bypass the variant pipeline at write time.
 */
export function largestVariantUrl(
  image: ImageMetadata,
  format: ImageVariantFormat = "webp",
): string {
  if (isVectorExt(image.originalExt)) return originalImageUrl(image);
  const eligible = IMAGE_VARIANT_WIDTHS.filter((w) => w <= image.width);
  if (eligible.length === 0) return originalImageUrl(image);
  const largest = Math.max(...eligible);
  return `/images/${image.contentSlug}/${image.id}/${largest}.${format}`;
}
