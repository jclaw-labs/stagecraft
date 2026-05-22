import type { ReactNode } from "react";
import type { Metadata } from "next";

import { AppearanceStyles } from "@/components/AppearanceStyles";
import { PageBackgroundUnderlay } from "@/components/PageBackgroundUnderlay";
import { PhotoLightboxBoot } from "@/components/PhotoLightboxBoot";
import { getFsReadStore } from "@/lib/collections";
import { readAppearance, readSiteConfig } from "@/lib/content";
import { type ImageMetadata } from "@/lib/image-types";

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
  const site = await readSiteConfig(getFsReadStore());
  if (!site.favicon) return {};
  // Favicons use the original upload — they're typically small enough
  // (256x256 or less) that none of the 400/800/1600 sharp variants
  // exist, and browsers cache favicons aggressively so picking a
  // smaller variant wouldn't help bandwidth meaningfully.
  return { icons: { icon: imageOriginalUrl(site.favicon) } };
}

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const store = getFsReadStore();
  const [appearance, site] = await Promise.all([readAppearance(store), readSiteConfig(store)]);

  return (
    <div className="stagecraft-site">
      {site.pageBackground ? <PageBackgroundUnderlay image={site.pageBackground} /> : null}
      <AppearanceStyles appearance={appearance} />
      {children}
      {/* Single page-level bootstrap that enhances any photo
          gallery on this page with a modal lightbox. Doesn't
          render anything until a gallery tile is clicked; cheap
          on pages without galleries. */}
      <PhotoLightboxBoot />
    </div>
  );
}

/**
 * Path to the original uploaded image on disk. Used for the favicon
 * field where a single URL is wanted rather than the responsive
 * `<picture>` srcSet the `Image` component emits.
 */
function imageOriginalUrl(image: ImageMetadata): string {
  return `/images/${image.contentSlug}/${image.id}/original.${image.originalExt}`;
}
