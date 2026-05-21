import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";

import { AppearanceStyles } from "@/components/AppearanceStyles";
import { readAppearance, readSiteConfig } from "@/lib/content";
import {
  IMAGE_VARIANT_WIDTHS,
  isVectorExt,
  type ImageMetadata,
} from "@/lib/image-types";

/**
 * Public-site layout wrapper.
 *
 * Loaded only by routes inside `src/app/(public)/` — not by `/admin` or
 * `/api/*`. Injects the appearance-driven CSS variables and Google Fonts
 * link so every public page renders with the artist's chosen palette and
 * typography without each page handler having to opt in.
 *
 * Header + Footer are rendered per-page (not here) so individual pages can
 * suppress them (splash pages skip both; the per-page "Hide footer" toggle
 * drops just the footer).
 *
 * Site-level chrome surfaced here (parity with the legacy template):
 *   - `siteConfig.favicon` → `<link rel="icon">` via Next's metadata API
 *   - `siteConfig.pageBackground` → fixed-positioned underlay `<div>` with
 *     a CSS background image. Underlay rather than `background-attachment:
 *     fixed` on the wrapper because iOS Safari treats that as `scroll`;
 *     a fixed-positioned element behaves consistently across devices and
 *     was the legacy pattern.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await readSiteConfig();
  if (!site.favicon) return {};
  // Favicons use the original upload — they're typically small enough
  // (256x256 or less) that none of the 400/800/1600 sharp variants
  // exist, and browsers cache favicons aggressively so picking a
  // smaller variant wouldn't help bandwidth meaningfully.
  return { icons: { icon: imageOriginalUrl(site.favicon) } };
}

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [appearance, site] = await Promise.all([readAppearance(), readSiteConfig()]);

  return (
    <div className="stagecraft-site">
      {site.pageBackground ? <PageBackgroundUnderlay image={site.pageBackground} /> : null}
      <AppearanceStyles appearance={appearance} />
      {children}
    </div>
  );
}

/**
 * Fixed-positioned bg layer painted behind page content. `aria-hidden`
 * because it's decorative; `zIndex: -1` so the page paints over it
 * with normal flow. `backgroundColor` fallback matches the
 * appearance's `--color-background` token so a slow / failed image
 * load doesn't flash white. `pointerEvents: "none"` so the underlay
 * can't intercept clicks even if a future style positions it above
 * the flow.
 */
function PageBackgroundUnderlay({ image }: { image: ImageMetadata }) {
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
 * Path to the original uploaded image on disk. Used for the favicon
 * field where a single URL is wanted rather than the responsive
 * `<picture>` srcSet the `Image` component emits.
 */
function imageOriginalUrl(image: ImageMetadata): string {
  return `/images/${image.contentSlug}/${image.id}/original.${image.originalExt}`;
}

/**
 * Largest sharp-generated variant that exists for the image (the
 * pipeline only emits widths ≤ source width), falling back to the
 * original upload when none exist (small uploads like 256x256
 * favicons, ICO/SVG uploads bypassing sharp — once those are
 * supported).
 *
 * Used by the page-background underlay. webp is the chosen format
 * because the variant pipeline emits both webp and avif and webp is
 * universally supported as of 2024 — picking avif would be ~10%
 * smaller but lose Safari ≤16 / iOS ≤16 viewers, which still mattered
 * at the time of writing. Future: emit a `<picture>` underlay with
 * both formats so newer Safari benefits from avif.
 */
function largestVariantUrl(image: ImageMetadata, format: "webp" | "avif"): string {
  // Vector / icon uploads bypass the sharp variant pipeline — no
  // sized webp/avif on disk. Serve the original; browsers handle SVG
  // / ICO as a CSS background-image directly.
  if (isVectorExt(image.originalExt)) return imageOriginalUrl(image);
  const eligible = IMAGE_VARIANT_WIDTHS.filter((w) => w <= image.width);
  if (eligible.length === 0) return imageOriginalUrl(image);
  const largest = Math.max(...eligible);
  return `/images/${image.contentSlug}/${image.id}/${largest}.${format}`;
}
